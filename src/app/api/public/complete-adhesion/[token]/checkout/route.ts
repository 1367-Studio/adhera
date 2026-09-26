import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { stripe, connectAccountChargesEnabled, PLATFORM_FEE } from "@/lib/stripe"
import { APP_URL } from "@/lib/env"
import { rateLimit, requestIp } from "@/lib/rate-limit"
import { SPOKEN_LANGUAGE_CODES } from "@/lib/languages"
import { ADDRESS_MAX_LENGTHS, addressColumns, addressIsFilled } from "@/lib/address"
import { findInvalidMembershipFormAnswer } from "@/lib/membership-form-answers-validation"

// Sibling of the GET at ../route.ts — see that file's header comment for why this is a
// deliberately separate, isolated pair of routes instead of another branch inside the real
// public checkout. Only ever charges one of the two paid, one-off MEMBERSHIP tiers "Adhesion
// 2026" actually has (see the plan this was built from) — no free tiers, no recurring, no
// installments, no addons/products/offline payment, all of which the real checkout supports
// but this one-off tool has no need to.
const schema = z.object({
  tierId: z.string().min(1),
  amount: z.number().positive().max(100000).optional(), // requis seulement si le tarif est à montant libre
  phone:  z.string().trim().max(30).optional(),
  mobile: z.string().trim().max(30).optional(),
  addressStreet:     z.string().trim().max(ADDRESS_MAX_LENGTHS.street).optional(),
  addressComplement: z.string().trim().max(ADDRESS_MAX_LENGTHS.complement).optional(),
  postalCode:        z.string().trim().max(ADDRESS_MAX_LENGTHS.postalCode).optional(),
  city:              z.string().trim().max(ADDRESS_MAX_LENGTHS.city).optional(),
  country:           z.string().trim().max(ADDRESS_MAX_LENGTHS.country).optional(),
  birthDate: z.string().trim().max(20).optional(),
  sexe:      z.enum(["HOMME", "FEMME"]).optional(),
  spokenLanguage: z.enum(SPOKEN_LANGUAGE_CODES).optional(),
  photoUrl:  z.string().url().max(500).optional(),
  answers:   z.record(z.string(), z.string().max(500)).optional().default({}),
  conditionsAgreed: z.boolean().optional().default(false),
})

const MIN_ITEM_AMOUNT = 1

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  if (!(await rateLimit(`adhesion-completion-checkout:${requestIp(req)}`, 10, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })
  }

  const { token } = await params
  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const membre = await prisma.membre.findUnique({
    where:  { adhesionCompletionToken: token },
    select: {
      id: true, firstName: true, lastName: true, email: true,
      associationId: true,
      association: { select: { name: true, slug: true, stripeConnectId: true } },
      adhesionCompletionForm: {
        select: {
          id: true, status: true, requireCguvSignature: true,
          fieldAddress: true, fieldBirthDate: true, fieldPhone: true, fieldMobile: true,
          fieldGender: true, fieldPhoto: true, fieldLanguage: true,
          tiers:        { where: { itemType: "MEMBERSHIP", kind: "ONE_OFF", free: false }, select: { id: true, label: true, freeAmount: true, amount: true } },
          customFields: { select: { id: true, type: true, label: true, required: true, options: true } },
        },
      },
    },
  })
  const form = membre?.adhesionCompletionForm
  if (!membre || !form || form.status !== "PUBLISHED") {
    return NextResponse.json({ error: "Lien invalide" }, { status: 404 })
  }

  if (!membre.association.stripeConnectId || !(await connectAccountChargesEnabled(membre.association.stripeConnectId)))
    return NextResponse.json({ error: "Paiement en ligne non disponible pour le moment." }, { status: 400 })

  if (form.requireCguvSignature && !parsed.data.conditionsAgreed)
    return NextResponse.json({ error: "Vous devez accepter les conditions générales pour adhérer." }, { status: 422 })

  const tier = form.tiers.find(t => t.id === parsed.data.tierId)
  if (!tier) return NextResponse.json({ error: "Tarif invalide" }, { status: 422 })

  const amount = tier.freeAmount ? parsed.data.amount : Number(tier.amount)
  if (!amount || amount <= 0) return NextResponse.json({ error: "Montant invalide" }, { status: 422 })
  if (tier.freeAmount) {
    const tierMinimum = tier.amount != null ? Number(tier.amount) : MIN_ITEM_AMOUNT
    if (amount < tierMinimum)
      return NextResponse.json({ error: `Le montant minimum pour « ${tier.label} » est de ${tierMinimum}€.` }, { status: 422 })
  }

  const { phone, birthDate, sexe, spokenLanguage, photoUrl: photoUrlValue } = parsed.data
  if (form.fieldAddress === "REQUIRED" && !addressIsFilled(parsed.data))
    return NextResponse.json({ error: "Le champ « Adresse » est requis." }, { status: 422 })
  const standardChecks: [string, string | undefined, string][] = [
    [form.fieldBirthDate, birthDate, "Date de naissance"],
    [form.fieldPhone,     phone,     "Téléphone"],
    [form.fieldMobile,    parsed.data.mobile, "Mobile"],
    [form.fieldGender,    sexe,      "Genre"],
    [form.fieldLanguage,  spokenLanguage, "Langue parlée"],
    [form.fieldPhoto,     photoUrlValue, "Photo"],
  ]
  for (const [requirement, value, label] of standardChecks) {
    if (requirement === "REQUIRED" && (!value || !value.trim()))
      return NextResponse.json({ error: `Le champ « ${label} » est requis.` }, { status: 422 })
  }

  const knownFieldIds = new Set(form.customFields.map(f => f.id))
  const invalidAnswer = findInvalidMembershipFormAnswer(form.customFields, parsed.data.answers)
  if (invalidAnswer) {
    const message = invalidAnswer.kind === "required"
      ? `Le champ « ${invalidAnswer.field.label} » est requis.`
      : `Le champ « ${invalidAnswer.field.label} » est invalide.`
    return NextResponse.json({ error: message }, { status: 422 })
  }
  const answers: Record<string, string> = {
    ...(parsed.data.mobile ? { mobile: parsed.data.mobile } : {}),
    ...Object.fromEntries(Object.entries(parsed.data.answers).filter(([k]) => knownFieldIds.has(k))),
  }

  const membreAddressColumns = addressColumns({
    street:     parsed.data.addressStreet,
    complement: parsed.data.addressComplement,
    postalCode: parsed.data.postalCode,
    city:       parsed.data.city,
    country:    parsed.data.country,
  })

  const slug = membre.association.slug
  const returnUrl = `${APP_URL}/${slug}/complete-adhesion/${token}`
  const amountCents = Math.round(amount * 100)
  const applicationFee = Math.round(amountCents * PLATFORM_FEE)

  // Identity (firstName/lastName/email) is never taken from the request — it's re-derived
  // from the Membre the token resolved to, same reasoning the GET route's read-only prefill
  // already assumes: a tampered payload must not be able to relabel whose adhésion this is.
  //
  // Duplicated on both session.metadata and payment_intent_data.metadata — same convention
  // as checkout/route.ts's commonMeta: the webhook handler reads session.metadata (that's
  // the object handleAdhesionCompletion actually receives), while the PaymentIntent's own
  // copy is what a later refund-reconciliation lookup or the Stripe dashboard would read
  // directly off the charge. A session-only copy (caught in dev testing before this shipped)
  // left the handler with no membreId/tierId/formId to act on — a silent no-op on every
  // real payment.
  const meta = {
    kind: "adhesion-completion", membreId: membre.id, tierId: tier.id, formId: form.id,
    phone: phone || "", ...membreAddressColumns,
    birthDate: birthDate || "", sexe: sexe || "", spokenLanguage: spokenLanguage || "",
    photoUrl: photoUrlValue || "", answers: JSON.stringify(answers),
  }
  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [{
      price_data: {
        currency:     "eur",
        unit_amount:  amountCents,
        product_data: { name: `${tier.label} — ${membre.association.name}` },
      },
      quantity: 1,
    }],
    payment_intent_data: {
      application_fee_amount: applicationFee,
      transfer_data:          { destination: membre.association.stripeConnectId },
      metadata: meta,
    },
    metadata: meta,
    customer_email: membre.email ?? undefined,
    success_url: `${returnUrl}?payment=success`,
    cancel_url:  `${returnUrl}?payment=cancelled`,
  })

  if (!checkoutSession.url)
    return NextResponse.json({ error: "Erreur lors de la création du paiement" }, { status: 500 })

  return NextResponse.json({ url: checkoutSession.url })
}
