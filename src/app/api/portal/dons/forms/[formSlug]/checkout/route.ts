import { NextResponse } from "next/server"
import { z } from "zod"
import type Stripe from "stripe"
import { stripe, connectAccountChargesEnabled, stripeRecurringInterval, PLATFORM_FEE } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { APP_URL } from "@/lib/env"
import { isValidSiret } from "@/lib/siret"
import { addressColumns, formatAddress } from "@/lib/address"
import { writeActivityLog } from "@/lib/activity-log"
import { eligibleReceiptAmount } from "@/lib/receipt-eligibility"
import { withPortalAuth } from "@/lib/api-wrapper"
import { sendEmail } from "@/lib/mail"
import { donPendingEmail } from "@/lib/email"
import { resolveDocumentBranding } from "@/lib/plan-limits"

// Mirrors MIN_DONATION_AMOUNT in /api/public/[slug]/dons/[formSlug]/checkout/route.ts.
const MIN_DONATION_AMOUNT = 1

const schema = z.object({
  tierId:        z.string().min(1),
  paymentMethod: z.enum(["STRIPE", "ESPECES", "CHEQUE", "VIREMENT"]).optional().default("STRIPE"),
  amount:        z.number().min(MIN_DONATION_AMOUNT).max(100000).optional(), // requis seulement si le palier est à montant libre
  donorType:     z.enum(["INDIVIDUAL", "COMPANY"]).optional().default("INDIVIDUAL"),
  companyName:   z.string().trim().min(1).max(200).optional(),
  siret:         z.string().trim().regex(/^\d{14}$/, "SIRET invalide (14 chiffres)").optional(),
  // `address` reste le champ hérité en texte libre : un onglet resté ouvert sur l'ancien
  // formulaire ne poste que celui-là, et il doit rester accepté (voir src/lib/address.ts).
  address:       z.string().trim().max(300).optional(),
  addressStreet:     z.string().trim().max(200).optional(),
  addressComplement: z.string().trim().max(200).optional(),
  postalCode:        z.string().trim().max(20).optional(),
  city:              z.string().trim().max(100).optional(),
  country:           z.string().trim().max(100).optional(),
  birthDate:     z.string().trim().max(20).optional(),
  phone:         z.string().trim().max(30).optional(),
  mobile:        z.string().trim().max(30).optional(),
  gender:        z.string().trim().max(30).optional(),
  message:       z.string().trim().max(500).optional(),
  anonymous:     z.boolean().optional().default(false),
  answers:       z.record(z.string(), z.union([z.string().max(500), z.array(z.string().max(500)).max(50)])).optional().default({}),
  conditionsAgreed: z.boolean().optional().default(false),
}).refine(
  d => d.donorType !== "COMPANY" || (!!d.companyName && !!d.siret),
  { message: "Nom de l'entreprise et SIRET requis pour un don d'entreprise", path: ["companyName"] },
).refine(
  d => d.donorType !== "COMPANY" || !d.siret || isValidSiret(d.siret),
  { message: "Numéro de SIRET invalide", path: ["siret"] },
)

export const POST = withPortalAuth<{ formSlug: string }>(async (req, ctx, { formSlug }) => {
  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const [assoc, membre] = await Promise.all([
    prisma.association.findUnique({
      where:  { id: ctx.associationId },
      select: { id: true, name: true, slug: true, stripeConnectId: true, plan: true, customBrandingEnabled: true, logoUrl: true },
    }),
    prisma.membre.findUnique({
      where:  { id: ctx.membreId! },
      select: { id: true, firstName: true, lastName: true, email: true },
    }),
  ])
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })
  // L'identité vient du profil du membre déjà authentifié, jamais du corps de la requête —
  // contrairement au formulaire public, qui accueille un inconnu et doit lui faire confiance.
  if (!membre.email)
    return NextResponse.json({ error: "Ajoutez un e-mail à votre profil avant de faire un don." }, { status: 422 })

  const form = await prisma.donationForm.findFirst({
    where:   { slug: formSlug, associationId: assoc.id, status: "PUBLISHED" },
    include: { tiers: true, customFields: true },
  })
  if (!form) return NextResponse.json({ error: "Formulaire introuvable" }, { status: 404 })

  const now = new Date()
  if (form.opensAt && form.opensAt > now) return NextResponse.json({ error: "Ce formulaire n'est pas encore ouvert." }, { status: 422 })
  if (form.closesAt && form.closesAt < now) return NextResponse.json({ error: "Ce formulaire est fermé." }, { status: 422 })

  if (form.requireCguvSignature && !parsed.data.conditionsAgreed)
    return NextResponse.json({ error: "Vous devez accepter les conditions générales pour faire un don." }, { status: 422 })
  const cguvAgreedAt = parsed.data.conditionsAgreed ? now : null

  const { paymentMethod } = parsed.data
  const isOffline = paymentMethod !== "STRIPE"

  const tier = form.tiers.find(t => t.id === parsed.data.tierId)
  if (!tier) return NextResponse.json({ error: "Palier invalide" }, { status: 422 })

  if (isOffline) {
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
  if (tier.freeAmount && tier.amount != null && amount < Number(tier.amount))
    return NextResponse.json({ error: `Le montant minimum pour « ${tier.label} » est de ${Number(tier.amount)}€.` }, { status: 422 })
  if (!isOffline && amount < MIN_DONATION_AMOUNT)
    return NextResponse.json({ error: `Le montant minimum est de ${MIN_DONATION_AMOUNT} €.` }, { status: 422 })
  if (tier.receiptMode === "PARTIAL" && tier.ineligibleAmount != null && amount < Number(tier.ineligibleAmount))
    return NextResponse.json({ error: "Le montant du don ne peut pas être inférieur au montant non éligible au reçu fiscal configuré pour ce palier." }, { status: 422 })

  const { address, addressStreet, addressComplement, postalCode, city, country, birthDate, phone, mobile, gender } = parsed.data
  // Même raisonnement que la route publique : l'adresse arrive structurée (formulaire
  // actuel) ou en texte libre (onglet resté ouvert sur l'ancien formulaire), et ce bloc
  // sert autant au contrôle « champ requis » qu'à l'écriture en base.
  const donorAddress = { street: addressStreet, complement: addressComplement, postalCode, city, country, legacy: address }
  const composedAddress = formatAddress(donorAddress)
  const standardChecks: [string, string | undefined, string][] = [
    [form.fieldAddress,   composedAddress ?? undefined, "Adresse"],
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
    const isEmpty = Array.isArray(value) ? value.length === 0 : (value == null || value.trim() === "")
    if (field.required && isEmpty)
      return NextResponse.json({ error: `Le champ « ${field.label} » est requis.` }, { status: 422 })
    if (isEmpty) continue
    if (field.type === "SELECT" || field.type === "RADIO") {
      const options = Array.isArray(field.options) ? field.options as string[] : []
      if (typeof value !== "string" || !options.includes(value))
        return NextResponse.json({ error: `Le champ « ${field.label} » est invalide.` }, { status: 422 })
    }
    if (field.type === "CHECKBOX_MULTI") {
      const options = Array.isArray(field.options) ? field.options as string[] : []
      if (!Array.isArray(value) || !value.every(v => options.includes(v)))
        return NextResponse.json({ error: `Le champ « ${field.label} » est invalide.` }, { status: 422 })
    }
  }

  const answers: Record<string, string | string[]> = {
    ...(birthDate ? { birthDate } : {}),
    ...(phone     ? { phone }     : {}),
    ...(mobile    ? { mobile }    : {}),
    ...(gender    ? { gender }    : {}),
    ...Object.fromEntries(Object.entries(parsed.data.answers).filter(([k]) => knownFieldIds.has(k))),
  }

  const { donorType, companyName, siret, message, anonymous } = parsed.data
  const { firstName, lastName, email } = membre

  const amountCents = Math.round(amount * 100)
  const successUrl   = `${APP_URL}/portal/${assoc.slug}/dons/${formSlug}?payment=success`
  const cancelUrl    = `${APP_URL}/portal/${assoc.slug}/dons/${formSlug}?payment=cancelled`

  if (isOffline) {
    // Voir le commentaire équivalent dans la route publique — même garde anti-double-clic.
    const recentDuplicate = await prisma.don.findFirst({
      where: {
        associationId: assoc.id, donationFormId: form.id, tierId: tier.id, membreId: membre.id,
        amount, paymentMethod,
        createdAt: { gte: new Date(Date.now() - 15_000) },
      },
    })
    if (recentDuplicate) return NextResponse.json({ offline: true })

    const don = await prisma.don.create({
      data: {
        associationId:  assoc.id,
        donationFormId: form.id,
        tierId:         tier.id,
        membreId:       membre.id,
        paymentMethod,
        donorType,
        firstName,
        lastName,
        companyName: donorType === "COMPANY" ? companyName : null,
        siret:       donorType === "COMPANY" ? siret : null,
        email:       email!,
        // Les six colonnes d'adresse sont écrites ensemble, colonne héritée comprise — voir
        // addressColumns (src/lib/address.ts).
        ...addressColumns(donorAddress),
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
      associationId: assoc.id, actorId: ctx.userId, action: "DON_CREATED", entity: "Don", entityId: don.id,
      label: `${firstName} ${lastName} — ${amount}€ (${form.title}, ${paymentMethod})`,
    })

    // Fire-and-forget, comme sur la route publique — un échec d'envoi ne doit pas faire
    // échouer la soumission, le don est déjà enregistré de toute façon.
    sendEmail(
      donPendingEmail({
        firstName, email: email!, associationName: assoc.name, amount,
        paymentMethod: paymentMethod as "ESPECES" | "CHEQUE" | "VIREMENT",
        offlineInstructions: form.offlineInstructions,
        branding: resolveDocumentBranding(assoc),
      }),
      { associationId: assoc.id, source: "TRANSACTION", sourceId: don.id },
    ).catch(() => {})

    return NextResponse.json({ offline: true })
  }

  if (tier.kind === "RECURRING") {
    const subscriptionMeta = {
      kind:           "donation",
      donationFormId: form.id,
      tierId:         tier.id,
      associationId:  assoc.id,
      membreId:       membre.id,
      donorType,
      firstName,
      lastName,
      companyName: donorType === "COMPANY" ? (companyName ?? "") : "",
      siret:       donorType === "COMPANY" ? (siret ?? "") : "",
      email:       email!,
      // L'adresse voyage dans les métadonnées Stripe champ par champ : la souscription
      // n'existe en base qu'au retour du webhook, qui la réécrira via addressColumns.
      address:           address           ?? "",
      addressStreet:     addressStreet     ?? "",
      addressComplement: addressComplement ?? "",
      postalCode:        postalCode        ?? "",
      city:              city              ?? "",
      country:           country           ?? "",
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
          transfer_data:           { destination: assoc.stripeConnectId! },
          application_fee_percent: PLATFORM_FEE * 100,
          metadata:                subscriptionMeta,
        },
        metadata:       subscriptionMeta,
        customer_email: email!,
        success_url:    successUrl,
        cancel_url:     cancelUrl,
      })
    } catch (err) {
      console.error(`[portal-donation-checkout] Stripe session creation failed for form ${form.id}:`, err)
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
      membreId:       membre.id,
      paymentMethod: "STRIPE",
      donorType,
      firstName,
      lastName,
      companyName: donorType === "COMPANY" ? companyName : null,
      siret:       donorType === "COMPANY" ? siret : null,
      email:       email!,
      // Idem que la branche hors ligne ci-dessus : les six colonnes écrites ensemble.
      ...addressColumns(donorAddress),
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
    associationId: assoc.id, actorId: ctx.userId, action: "DON_CREATED", entity: "Don", entityId: don.id,
    label: `${firstName} ${lastName} — ${amount}€ (${form.title})`,
  })

  const applicationFee = Math.round(amountCents * PLATFORM_FEE)

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
        application_fee_amount: applicationFee,
        transfer_data:          { destination: assoc.stripeConnectId! },
        metadata:               { donId: don.id, associationId: assoc.id },
      },
      metadata:    { donId: don.id },
      success_url: successUrl,
      cancel_url:  cancelUrl,
    })
  } catch (err) {
    console.error(`[portal-donation-checkout] Stripe session creation failed for don ${don.id}:`, err)
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
}, { module: "dons" })
