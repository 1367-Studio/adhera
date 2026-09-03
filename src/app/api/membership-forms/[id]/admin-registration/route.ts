import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { z } from "zod"
import { addMonths } from "date-fns"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { sendEmail } from "@/lib/mail"
import { membershipPaymentLinkEmail } from "@/lib/email"
import { APP_URL } from "@/lib/env"
import { assertMemberLimit, MemberLimitReachedError, resolveDocumentBranding } from "@/lib/plan-limits"
import { eligibleReceiptAmount } from "@/lib/receipt-eligibility"
import { currentCotisationYear } from "@/lib/membre-adherent"
import { writeActivityLog } from "@/lib/activity-log"
import { SPOKEN_LANGUAGE_CODES } from "@/lib/languages"

// Same role set as POST /api/membres — whoever can create a member can register one
// through a form on their behalf.
const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

// The public adhésion form, filled by a manager instead of the member (mode admin — see
// membership-form-public-form.tsx's isAdminFill): the member's profile is created exactly
// as a self-service signup would create it, but no User/password exists yet and nothing is
// charged here. Instead the person gets the tokenized public payment link by email
// (/cotisation/[token]); once the payment settles, the Stripe webhook's cotisationId branch
// grants portal access and notifies the managers. Deliberately narrower than the public
// checkout: no password, no offline/addons/products/installments/multi-registrant — the
// payment link only ever charges the cotisation itself, one-off, online.
const schema = z.object({
  tierId:      z.string().min(1),
  amount:      z.number().positive().max(100000).optional(), // requis seulement si le tier est à montant libre
  firstName:   z.string().trim().min(1).max(100),
  lastName:    z.string().trim().min(1).max(100),
  email:       z.string().email().max(200),
  address:     z.string().trim().max(300).optional(),
  birthDate:   z.string().trim().max(20).optional(),
  phone:       z.string().trim().max(30).optional(),
  mobile:      z.string().trim().max(30).optional(),
  sexe:        z.enum(["HOMME", "FEMME"]).optional(),
  spokenLanguage: z.enum(SPOKEN_LANGUAGE_CODES).optional(),
  photoUrl:    z.string().url().max(500).optional(),
  locale:      z.enum(["fr", "en", "pt", "pt-PT", "es"]).optional(),
  answers:     z.record(z.string(), z.string().max(500)).optional().default({}),
})

export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const assoc = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { id: true, name: true, slug: true, stripeConnectId: true, plan: true, customBrandingEnabled: true, logoUrl: true },
  })
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })
  // The whole point of this flow is the emailed Stripe payment link — without a connected
  // account the link would land on a dead "paiement indisponible" page.
  if (!assoc.stripeConnectId)
    return NextResponse.json({ error: "Connectez Stripe pour envoyer des liens de paiement." }, { status: 422 })

  const form = await prisma.membershipForm.findFirst({
    where:   { id, associationId, status: "PUBLISHED" },
    include: { tiers: true, customFields: true },
  })
  if (!form) return NextResponse.json({ error: "Formulaire introuvable" }, { status: 404 })

  // Only tiers the payment link can actually charge: one-off, paid, adhésion. The client
  // already filters its picker the same way (see isAdminFill in the form component) — this
  // is the server-side re-check.
  const tier = form.tiers.find(t =>
    t.id === parsed.data.tierId && t.itemType === "MEMBERSHIP" && t.kind === "ONE_OFF" && !t.free)
  if (!tier) return NextResponse.json({ error: "Tarif invalide" }, { status: 422 })

  const membershipAmount = tier.freeAmount ? parsed.data.amount : Number(tier.amount ?? 0)
  if (!membershipAmount || membershipAmount <= 0)
    return NextResponse.json({ error: "Montant invalide" }, { status: 422 })
  if (tier.freeAmount && tier.amount != null && membershipAmount < Number(tier.amount))
    return NextResponse.json({ error: "Montant invalide" }, { status: 422 })
  if (tier.freeAmount && tier.receiptMode === "PARTIAL" && tier.ineligibleAmount != null && membershipAmount < Number(tier.ineligibleAmount))
    return NextResponse.json({ error: "Le montant payé ne peut pas être inférieur au montant non éligible au reçu fiscal configuré pour ce tarif." }, { status: 422 })

  // Same field-matrix validation as the public checkout — the manager fills the same form,
  // the same fields stay required.
  const { address, birthDate, phone, mobile, sexe, spokenLanguage, photoUrl } = parsed.data
  const standardChecks: [string, string | undefined, string][] = [
    [form.fieldAddress,   address,   "Adresse"],
    [form.fieldBirthDate, birthDate, "Date de naissance"],
    [form.fieldPhone,     phone,     "Téléphone"],
    [form.fieldMobile,    mobile,    "Mobile"],
    [form.fieldGender,    sexe,      "Genre"],
    [form.fieldLanguage,  spokenLanguage, "Langue parlée"],
    [form.fieldPhoto,     photoUrl,  "Photo"],
  ]
  for (const [requirement, value, label] of standardChecks) {
    if (requirement === "REQUIRED" && (!value || !value.trim()))
      return NextResponse.json({ error: `Le champ « ${label} » est requis.` }, { status: 422 })
  }
  const knownFieldIds = new Set(form.customFields.map(f => f.id))
  for (const field of form.customFields) {
    const value = parsed.data.answers[field.id]
    if (field.required && (value == null || value.trim() === ""))
      return NextResponse.json({ error: `Le champ « ${field.label} » est requis.` }, { status: 422 })
  }
  // Même convention que le checkout public : seul "mobile" (pas de colonne dédiée) et les
  // réponses aux champs du formulaire vont dans Membre.answers.
  const answers: Record<string, string> = {
    ...(mobile ? { mobile } : {}),
    ...Object.fromEntries(Object.entries(parsed.data.answers).filter(([k]) => knownFieldIds.has(k))),
  }

  const { firstName, lastName, locale } = parsed.data
  const email = parsed.data.email.toLowerCase()

  const existing = await prisma.membre.findFirst({
    where: { associationId, email, deletedAt: null },
  })
  if (existing) return NextResponse.json({ error: "Cette adresse email est déjà utilisée." }, { status: 409 })

  // Same guard as POST /api/membres — this route creates a Membre too, and must not become a
  // way around the plan's member cap just because it's reached through a form.
  try {
    await assertMemberLimit(associationId)
  } catch (err) {
    if (err instanceof MemberLimitReachedError) return NextResponse.json({ error: err.message, code: err.code }, { status: 422 })
    throw err
  }

  const now         = new Date()
  const periodStart = tier.fixedPeriodEnd || tier.durationMonths ? now : null
  const periodEnd   = tier.fixedPeriodEnd ?? (tier.durationMonths ? addMonths(now, tier.durationMonths) : null)

  let membre, cotisation
  try {
    ({ membre, cotisation } = await prisma.$transaction(async (tx) => {
      const membre = await tx.membre.create({
        data: {
          firstName, lastName, email,
          phone:          phone || null,
          address:        address || null,
          birthDate:      birthDate ? new Date(birthDate) : null,
          sexe:           sexe || null,
          spokenLanguage: spokenLanguage || null,
          photoUrl:       photoUrl || null,
          preferredLocale: locale || null,
          status:         "ACTIF",
          associationId,
          typeId:         tier.membreTypeId,
          answers:        Object.keys(answers).length ? answers : undefined,
        },
      })
      const cotisation = await tx.cotisation.create({
        data: {
          membreId: membre.id, associationId, year: currentCotisationYear(now),
          amount: membershipAmount, status: "EN_ATTENTE",
          membershipFormId: form.id, tierId: tier.id,
          periodStart, periodEnd, receiptMode: tier.receiptMode,
          deductibleAmount: eligibleReceiptAmount(membershipAmount, tier.receiptMode, tier.ineligibleAmount != null ? Number(tier.ineligibleAmount) : null),
          paymentToken: randomBytes(20).toString("hex"),
        },
        select: { id: true, year: true, paymentToken: true },
      })
      return { membre, cotisation }
    }))
  } catch (err) {
    // Double-clic / deux onglets — même 409 amical que le checkout public.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")
      return NextResponse.json({ error: "Cette adresse email est déjà utilisée." }, { status: 409 })
    throw err
  }

  // Awaited: a fire-and-forget promise here can get torn down by Vercel's serverless runtime
  // before Resend is ever called (confirmed on this exact pattern elsewhere — see da57b4f).
  // This email is the only way the person hears about the membership at all at this point,
  // so losing it silently would leave the manager thinking it was sent when it never left.
  await sendEmail(membershipPaymentLinkEmail({
    firstName, email,
    associationName: assoc.name,
    formTitle:       form.title,
    amount:          membershipAmount,
    year:            cotisation.year,
    payUrl:          `${APP_URL}/cotisation/${cotisation.paymentToken}`,
    branding:        resolveDocumentBranding(assoc),
  }), { associationId, membreId: membre.id, source: "TRANSACTION" }).catch(() => {})

  await writeActivityLog({
    associationId,
    actorId:  userId,
    action:   "MEMBRE_CREATED",
    entity:   "Membre",
    entityId: membre.id,
    label:    `${firstName} ${lastName}`,
    metadata: { via: "admin-registration", formId: form.id, tierId: tier.id },
  })

  return NextResponse.json({ sent: true, email })
}, { roles: MANAGERS, module: "cotisations" })
