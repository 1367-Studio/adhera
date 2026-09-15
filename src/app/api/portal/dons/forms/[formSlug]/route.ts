import { NextResponse } from "next/server"
import { getLocale } from "next-intl/server"
import { prisma } from "@/lib/prisma/client"
import { translateFields } from "@/lib/i18n/translate"
import type { Locale } from "@/i18n/locales"
import { connectAccountChargesEnabled } from "@/lib/stripe"
import { eligibleReceiptAmount } from "@/lib/receipt-eligibility"
import { withPortalAuth } from "@/lib/api-wrapper"

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
      select: { firstName: true, lastName: true, email: true, address: true, phone: true },
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
      console.error(`[portal-donation-form] failed to check payment availability for ${ctx.associationId}/${formSlug}:`, err)
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

  return NextResponse.json({
    associationName:     assoc.name,
    id:                  form.id,
    title:               content.title,
    imageUrl:            form.imageUrl,
    description:         content.description,
    conditions:          content.conditions,
    attachments:          form.attachments ?? [],
    requireCguvSignature: form.requireCguvSignature,
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
      address:   membre?.address ?? "",
      phone:     membre?.phone ?? "",
    },
  })
}, { module: "dons" })
