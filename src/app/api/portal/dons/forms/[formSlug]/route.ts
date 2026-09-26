import { NextResponse } from "next/server"
import { getLocale } from "next-intl/server"
import { publicFormTerms } from "@/lib/form-terms"
import { storedTermsAttachments } from "@/lib/form-terms-response"
import { prisma } from "@/lib/prisma/client"
import { translateFields } from "@/lib/i18n/translate"
import type { Locale } from "@/i18n/locales"
import { connectAccountChargesEnabled } from "@/lib/stripe"
import { eligibleReceiptAmount } from "@/lib/receipt-eligibility"
import { withPortalAuth } from "@/lib/api-wrapper"
import { reportError } from "@/lib/monitoring"

// Same shape as /api/public/[slug]/dons/[formSlug], minus the `visibility: { not: "PRIVATE" }`
// filter — see the sibling list route's comment for why PRIVATE is portal-visible here.
export const GET = withPortalAuth<{ formSlug: string }>(async (_req, ctx, { formSlug }) => {
  const [assoc, membre] = await Promise.all([
    prisma.association.findUnique({
      where:  { id: ctx.associationId },
      select: { name: true, canIssueTaxReceipts: true, stripeConnectId: true },
    }),
    prisma.membre.findUnique({
      where:  { id: ctx.membreId! },
      // Les six colonnes d'adresse sont lues ensemble : le formulaire pré-remplit son bloc
      // adresse avec addressFormValues, qui retombe sur le texte libre hérité quand la fiche
      // n'a pas encore été migrée (voir src/lib/address.ts).
      select: {
        firstName: true, lastName: true, email: true, phone: true,
        address: true, addressStreet: true, addressComplement: true,
        postalCode: true, city: true, country: true,
      },
    }),
  ])
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const form = await prisma.donationForm.findFirst({
    where: { slug: formSlug, associationId: ctx.associationId, status: "PUBLISHED" },
    include: {
      tiers:        { orderBy: { order: "asc" } },
      customFields: { orderBy: { order: "asc" } },
    },
  })
  if (!form) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const now       = new Date()
  const notOpenYet = !!form.opensAt && form.opensAt > now
  const closed      = !!form.closesAt && form.closesAt < now

  let paymentEnabled = false
  if (form.allowOnline && assoc.stripeConnectId) {
    try {
      paymentEnabled = await connectAccountChargesEnabled(assoc.stripeConnectId)
    } catch (err) {
      reportError(err, { area: "stripe", action: "portal.don.form-payment-availability", extra: { associationId: ctx.associationId, formSlug } })
    }
  }

  const locale = (await getLocale()) as Locale
  const [content] = await translateFields(
    [{
      title:               form.title,
      description:         form.description,
      conditions:          form.conditions,
      confirmationMessage: form.confirmationMessage,
      offlineInstructions: form.offlineInstructions,
    }],
    ["title", "description", "conditions", "confirmationMessage", "offlineInstructions"],
    locale,
    ctx.associationId,
  )
  const tiers        = await translateFields(form.tiers, ["label"], locale, ctx.associationId)
  const customFields = await translateFields(form.customFields, ["label"], locale, ctx.associationId)

  // Only what actually exists reaches the page: empty editor markup is no text, and a form
  // "required" with nothing to accept (saved before the rule) shows no checkbox.
  const terms = publicFormTerms({
    conditions:           form.conditions,
    attachments:          storedTermsAttachments(form.attachments),
    requireCguvSignature: form.requireCguvSignature,
  })

  return NextResponse.json({
    associationName:     assoc.name,
    id:                  form.id,
    title:               content.title,
    imageUrl:            form.imageUrl,
    description:         content.description,
    conditions:          terms.conditions === null ? null : content.conditions,
    attachments:          terms.attachments,
    requireCguvSignature: terms.requiresTermsAcceptance,
    contactEmail:        form.contactEmail,
    contactPhone:        form.contactPhone,
    fieldAddress:        form.fieldAddress,
    fieldBirthDate:      form.fieldBirthDate,
    fieldPhone:          form.fieldPhone,
    fieldMobile:         form.fieldMobile,
    fieldGender:         form.fieldGender,
    confirmationMessage: content.confirmationMessage,
    offlineInstructions: content.offlineInstructions,
    allowCash:           form.allowCash,
    allowCheque:         form.allowCheque,
    allowTransfer:       form.allowTransfer,
    notOpenYet,
    closed,
    paymentEnabled,
    canIssueTaxReceipts: assoc.canIssueTaxReceipts,
    tiers: tiers.map(t => ({
      id: t.id, label: t.label, kind: t.kind, interval: t.interval, freeAmount: t.freeAmount,
      amount: t.amount?.toString() ?? null, receiptMode: t.receiptMode,
      deductibleAmount: t.freeAmount || t.amount == null
        ? null
        : eligibleReceiptAmount(Number(t.amount), t.receiptMode, t.ineligibleAmount != null ? Number(t.ineligibleAmount) : null)?.toString() ?? null,
      ineligibleAmount: t.freeAmount && t.ineligibleAmount != null ? Number(t.ineligibleAmount) : null,
    })),
    customFields: customFields.map(f => ({ id: f.id, type: f.type, label: f.label, required: f.required, options: f.options })),
    member: {
      firstName: membre?.firstName ?? "",
      lastName:  membre?.lastName ?? "",
      email:     membre?.email ?? "",
      phone:     membre?.phone ?? "",
      address:           membre?.address           ?? "",
      addressStreet:     membre?.addressStreet     ?? "",
      addressComplement: membre?.addressComplement ?? "",
      postalCode:        membre?.postalCode        ?? "",
      city:              membre?.city              ?? "",
      country:           membre?.country           ?? "",
    },
  })
}, { module: "dons" })
