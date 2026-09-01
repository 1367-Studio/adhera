import { NextResponse } from "next/server"
import { z } from "zod"
import type Stripe from "stripe"
import { stripe, connectAccountChargesEnabled, stripeRecurringInterval } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"
import { APP_URL } from "@/lib/env"
import { rateLimit, requestIp } from "@/lib/rate-limit"
import { isValidSiret } from "@/lib/siret"
import { writeActivityLog } from "@/lib/activity-log"
import { eligibleReceiptAmount } from "@/lib/receipt-eligibility"

// Stripe refuses to charge below ~0,50 € on EUR cards. 1 € is a round number safely above
// that floor for every payment method (SEPA debit, cards, etc.) — enforced both here and
// client-side so a free-amount donor sees a clear message instead of a raw Stripe error.
const MIN_DONATION_AMOUNT = 1

const schema = z.object({
  tierId:      z.string().min(1),
  paymentMethod: z.enum(["STRIPE", "ESPECES", "CHEQUE", "VIREMENT"]).optional().default("STRIPE"),
  amount:      z.number().min(MIN_DONATION_AMOUNT).max(100000).optional(), // requis seulement si le palier est à montant libre
  donorType:   z.enum(["INDIVIDUAL", "COMPANY"]).optional().default("INDIVIDUAL"),
  firstName:   z.string().trim().min(1).max(100),
  lastName:    z.string().trim().min(1).max(100),
  companyName: z.string().trim().min(1).max(200).optional(),
  siret:       z.string().trim().regex(/^\d{14}$/, "SIRET invalide (14 chiffres)").optional(),
  email:       z.string().email().max(200),
  address:     z.string().trim().max(300).optional(),
  birthDate:   z.string().trim().max(20).optional(),
  phone:       z.string().trim().max(30).optional(),
  mobile:      z.string().trim().max(30).optional(),
  gender:      z.string().trim().max(30).optional(),
  message:     z.string().trim().max(500).optional(),
  anonymous:   z.boolean().optional().default(false),
  answers:     z.record(z.string(), z.string().max(500)).optional().default({}),
  conditionsAgreed: z.boolean().optional().default(false),
  // Honeypot — jamais rempli par un vrai visiteur (masqué hors écran), même convention
  // que l'inscription publique aux événements.
  website:     z.string().optional().or(z.literal("")),
}).refine(
  d => d.donorType !== "COMPANY" || (!!d.companyName && !!d.siret),
  { message: "Nom de l'entreprise et SIRET requis pour un don d'entreprise", path: ["companyName"] },
).refine(
  d => d.donorType !== "COMPANY" || !d.siret || isValidSiret(d.siret),
  { message: "Numéro de SIRET invalide", path: ["siret"] },
)

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string; formSlug: string }> },
) {
  const { slug, formSlug } = await params

  if (!(await rateLimit(`donation-form-checkout:${requestIp(req)}`, 5, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })
  }

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  // Pretend success without touching the DB or Stripe — same anti-bot convention as the
  // event registration route.
  if (parsed.data.website) return NextResponse.json({ url: `${APP_URL}/${slug}/dons/${formSlug}` })

  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: { id: true, name: true, modules: true, stripeConnectId: true },
  })
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const modules = parseModules(assoc.modules)
  if (!modules.dons) return NextResponse.json({ error: "Module dons désactivé" }, { status: 403 })

  const form = await prisma.donationForm.findFirst({
    where:   { slug: formSlug, associationId: assoc.id, status: "PUBLISHED", visibility: { not: "PRIVATE" } },
    include: { tiers: true, customFields: true },
  })
  if (!form) return NextResponse.json({ error: "Formulaire introuvable" }, { status: 404 })

  const now = new Date()
  if (form.opensAt && form.opensAt > now) return NextResponse.json({ error: "Ce formulaire n'est pas encore ouvert." }, { status: 422 })
  if (form.closesAt && form.closesAt < now) return NextResponse.json({ error: "Ce formulaire est fermé." }, { status: 422 })

  // Le client refuse déjà de soumettre sans cette case cochée quand le formulaire l'exige —
  // revalidé ici pour ne jamais dépendre uniquement d'un contrôle contournable côté client.
  if (form.requireCguvSignature && !parsed.data.conditionsAgreed)
    return NextResponse.json({ error: "Vous devez accepter les conditions générales pour faire un don." }, { status: 422 })
  const cguvAgreedAt = parsed.data.conditionsAgreed ? now : null

  const { paymentMethod } = parsed.data
  const isOffline = paymentMethod !== "STRIPE"

  const tier = form.tiers.find(t => t.id === parsed.data.tierId)
  if (!tier) return NextResponse.json({ error: "Palier invalide" }, { status: 422 })

  if (isOffline) {
    // Espèces/chèque/virement are a manual, one-time act on the donor's side — there's no
    // equivalent of a recurring cheque arriving on its own every month.
    if (tier.kind === "RECURRING")
      return NextResponse.json({ error: "Le paiement hors ligne n'est pas disponible pour un don récurrent." }, { status: 400 })
    const allowed = paymentMethod === "ESPECES" ? form.allowCash : paymentMethod === "CHEQUE" ? form.allowCheque : form.allowTransfer
    if (!allowed) return NextResponse.json({ error: "Ce moyen de paiement n'est pas disponible pour ce formulaire" }, { status: 400 })
  } else {
    if (!form.allowOnline)
      return NextResponse.json({ error: "Paiement en ligne non disponible pour ce formulaire" }, { status: 400 })
    if (!assoc.stripeConnectId || !(await connectAccountChargesEnabled(assoc.stripeConnectId)))
      return NextResponse.json({ error: "Paiement en ligne non disponible" }, { status: 400 })
  }

  const amount = tier.freeAmount ? parsed.data.amount : Number(tier.amount)
  if (!amount || amount <= 0)
    return NextResponse.json({ error: "Montant invalide" }, { status: 422 })
  // Un palier à montant libre peut configurer son propre minimum — une règle de
  // l'association, applicable peu importe le moyen de paiement (pas seulement en ligne).
  if (tier.freeAmount && tier.amount != null && amount < Number(tier.amount))
    return NextResponse.json({ error: `Le montant minimum pour « ${tier.label} » est de ${Number(tier.amount)}€.` }, { status: 422 })
  // Below Stripe's charge floor — only relevant online; a small cash/cheque/transfer gift
  // has no such constraint. A fixed tier configured under this amount would otherwise fail
  // opaquely inside stripe.checkout.sessions.create below.
  if (!isOffline && amount < MIN_DONATION_AMOUNT)
    return NextResponse.json({ error: `Le montant minimum est de ${MIN_DONATION_AMOUNT} €.` }, { status: 422 })
  // Le montant non éligible est une part fixe du palier — un don en dessous de cette part
  // (montant libre) donnerait un reçu à montant négatif (voir eligibleReceiptAmount).
  if (tier.receiptMode === "PARTIAL" && tier.ineligibleAmount != null && amount < Number(tier.ineligibleAmount))
    return NextResponse.json({ error: "Le montant du don ne peut pas être inférieur au montant non éligible au reçu fiscal configuré pour ce palier." }, { status: 422 })

  // La matrice de champs standards (étape 3 de l'assistant) rend certains champs
  // obligatoires — validée ici plutôt que par un schéma zod statique puisqu'elle est
  // configurée par formulaire, même raisonnement que les EvenementCustomField.
  const { address, birthDate, phone, mobile, gender } = parsed.data
  const standardChecks: [string, string | undefined, string][] = [
    [form.fieldAddress,   address,   "Adresse"],
    [form.fieldBirthDate, birthDate, "Date de naissance"],
    [form.fieldPhone,     phone,     "Téléphone"],
    [form.fieldMobile,    mobile,    "Mobile"],
    [form.fieldGender,    gender,    "Genre"],
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

  // Don.answers regroupe les réponses aux champs standards (adresse mise à part — elle a
  // sa propre colonne) et aux DonationFormField, keyed par id — même convention que
  // Participation.answers pour les champs custom, avec des clés fixes pour les champs
  // standards puisqu'ils n'ont pas de ligne DonationFormField.
  const answers: Record<string, string> = {
    ...(birthDate ? { birthDate } : {}),
    ...(phone     ? { phone }     : {}),
    ...(mobile    ? { mobile }    : {}),
    ...(gender    ? { gender }    : {}),
    ...Object.fromEntries(Object.entries(parsed.data.answers).filter(([k]) => knownFieldIds.has(k))),
  }

  const { donorType, firstName, lastName, companyName, siret, email, message, anonymous } = parsed.data

  const amountCents = Math.round(amount * 100)
  const successUrl   = `${APP_URL}/${slug}/dons/${formSlug}?payment=success`
  const cancelUrl    = `${APP_URL}/${slug}/dons/${formSlug}?payment=cancelled`

  if (isOffline) {
    // No Stripe object at all here — paidAt stays null until an admin confirms the
    // cheque/transfer actually arrived (see /api/dons/[id]/encaisser). The donor sees
    // the form's offlineInstructions immediately instead of a Stripe redirect.
    const don = await prisma.don.create({
      data: {
        associationId:  assoc.id,
        donationFormId: form.id,
        tierId:         tier.id,
        paymentMethod,
        donorType,
        firstName,
        lastName,
        companyName: donorType === "COMPANY" ? companyName : null,
        siret:       donorType === "COMPANY" ? siret : null,
        email,
        address:   address || null,
        amount,
        message:   message || null,
        anonymous,
        answers:   Object.keys(answers).length ? answers : undefined,
        cguvAgreedAt,
        receiptMode:      tier.receiptMode,
        deductibleAmount: eligibleReceiptAmount(amount, tier.receiptMode, tier.ineligibleAmount != null ? Number(tier.ineligibleAmount) : null),
      },
    })

    await writeActivityLog({
      associationId: assoc.id, action: "DON_CREATED", entity: "Don", entityId: don.id,
      label: `${firstName} ${lastName} — ${amount}€ (${form.title}, ${paymentMethod})`,
    })

    return NextResponse.json({ offline: true })
  }

  if (tier.kind === "RECURRING") {
    // No DB row created ahead of time here — a Subscription id doesn't exist until Stripe
    // mints it, so there's nothing to hang metadata off of yet the way a one-off Don's id
    // does below. The donor's details ride through Stripe as metadata instead, and
    // handleDonationSubscriptionCheckout (src/lib/webhook/donation-subscriptions.ts) turns
    // them into a real DonationSubscription row once checkout.session.completed arrives
    // with a real stripeSubscriptionId/stripeCustomerId to key it on.
    const subscriptionMeta = {
      kind:           "donation",
      donationFormId: form.id,
      tierId:         tier.id,
      associationId:  assoc.id,
      donorType,
      firstName,
      lastName,
      companyName: donorType === "COMPANY" ? (companyName ?? "") : "",
      siret:       donorType === "COMPANY" ? (siret ?? "") : "",
      email,
      address: address ?? "",
      message: message ?? "",
      anonymous: String(anonymous),
      answers:   JSON.stringify(answers),
      cguvAgreedAt: cguvAgreedAt ? cguvAgreedAt.toISOString() : "",
      receiptMode:      tier.receiptMode,
      deductibleAmount: eligibleReceiptAmount(amount, tier.receiptMode, tier.ineligibleAmount != null ? Number(tier.ineligibleAmount) : null)?.toString() ?? "",
    }

    let checkoutSession: Stripe.Checkout.Session
    try {
      checkoutSession = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [
          {
            price_data: {
              currency:     "eur",
              unit_amount:  amountCents,
              recurring:    stripeRecurringInterval(tier.interval ?? "MONTH"),
              product_data: { name: `${form.title} — ${assoc.name}` },
            },
            quantity: 1,
          },
        ],
        subscription_data: {
          // Non-null: the `else` branch above already returned if this were unset — but that
          // narrowing doesn't survive past the offline branch's own early return in between.
          transfer_data: { destination: assoc.stripeConnectId! },
          metadata:      subscriptionMeta,
        },
        metadata:       subscriptionMeta,
        customer_email: email,
        success_url:    successUrl,
        cancel_url:     cancelUrl,
      })
    } catch (err) {
      // No DB row to clean up here (see the comment above) — but an uncaught throw would
      // otherwise surface as an opaque 500 whose JSON body the client can't parse, showing
      // "errorNetwork" instead of a real reason (e.g. amount below Stripe's floor).
      console.error(`[donation-checkout] Stripe session creation failed for form ${form.id}:`, err)
      return NextResponse.json({ error: "Erreur lors de la création du paiement" }, { status: 500 })
    }

    if (!checkoutSession.url)
      return NextResponse.json({ error: "Erreur lors de la création du paiement" }, { status: 500 })

    return NextResponse.json({ url: checkoutSession.url })
  }

  const don = await prisma.don.create({
    data: {
      associationId:  assoc.id,
      donationFormId: form.id,
      tierId:         tier.id,
      paymentMethod: "STRIPE",
      donorType,
      firstName,
      lastName,
      companyName: donorType === "COMPANY" ? companyName : null,
      siret:       donorType === "COMPANY" ? siret : null,
      email,
      address:   address || null,
      amount,
      message:   message || null,
      anonymous,
      answers:   Object.keys(answers).length ? answers : undefined,
      cguvAgreedAt,
      receiptMode:      tier.receiptMode,
      deductibleAmount: eligibleReceiptAmount(amount, tier.receiptMode, tier.ineligibleAmount != null ? Number(tier.ineligibleAmount) : null),
    },
  })

  await writeActivityLog({
    associationId: assoc.id, action: "DON_CREATED", entity: "Don", entityId: don.id,
    label: `${firstName} ${lastName} — ${amount}€ (${form.title})`,
  })

  let checkoutSession: Stripe.Checkout.Session
  try {
    checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency:     "eur",
            unit_amount:  amountCents,
            product_data: { name: `${form.title} — ${assoc.name}` },
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        transfer_data: { destination: assoc.stripeConnectId! },
        metadata:      { donId: don.id, associationId: assoc.id },
      },
      metadata:    { donId: don.id },
      success_url: successUrl,
      cancel_url:  cancelUrl,
    })
  } catch (err) {
    // The Don row above was created ahead of the Stripe call so its id could ride in
    // metadata — an uncaught throw here (e.g. amount below Stripe's floor, Connect account
    // restricted) must not leave it behind forever with no stripeSessionId and no way to
    // ever get paidAt set.
    console.error(`[donation-checkout] Stripe session creation failed for don ${don.id}:`, err)
    await prisma.don.delete({ where: { id: don.id } }).catch(() => {})
    return NextResponse.json({ error: "Erreur lors de la création du paiement" }, { status: 500 })
  }

  if (!checkoutSession.url) {
    await prisma.don.delete({ where: { id: don.id } }).catch(() => {})
    return NextResponse.json({ error: "Erreur lors de la création du paiement" }, { status: 500 })
  }

  await prisma.don.update({
    where: { id: don.id },
    data:  { stripeSessionId: checkoutSession.id },
  })

  return NextResponse.json({ url: checkoutSession.url })
}
