import { NextResponse } from "next/server"
import { getLocale } from "next-intl/server"
import { prisma } from "@/lib/prisma/client"
import { translateFields } from "@/lib/i18n/translate"
import type { Locale } from "@/i18n/locales"
import { parseModules } from "@/lib/modules"
import { connectAccountChargesEnabled } from "@/lib/stripe"
import { canPreviewForm } from "@/lib/form-preview"
import { eligibleReceiptAmount } from "@/lib/receipt-eligibility"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; formSlug: string }> },
) {
  const { slug, formSlug } = await params

  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: { id: true, name: true, modules: true, canIssueTaxReceipts: true, stripeConnectId: true },
  })
  if (!assoc) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const modules = parseModules(assoc.modules)
  if (!modules.dons) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const preview = await canPreviewForm(req, assoc.id)
  const form = await prisma.donationForm.findFirst({
    where: {
      slug: formSlug, associationId: assoc.id,
      ...(preview ? {} : { status: "PUBLISHED" as const, visibility: { not: "PRIVATE" as const } }),
    },
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
      // Informational only (drives whether the form renders payable) — the checkout
      // route re-checks for real before any money moves, same convention as the
      // standalone /api/public/[slug]/don route.
      console.error(`[public-donation-form] failed to check payment availability for ${slug}/${formSlug}:`, err)
    }
  }

  // Admin-authored content, translated on the fly for the visitor's locale — see the
  // matching note in the public adhésion route.
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
  )
  const tiers        = await translateFields(form.tiers, ["label"], locale)
  const customFields = await translateFields(form.customFields, ["label"], locale)

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
      // Montant fixe : le montant éligible est déjà calculable ici (montant payé = t.amount).
      // Montant libre : ineligibleAmount brut est exposé à la place, pour que le formulaire
      // public recalcule en direct le montant éligible au fur et à mesure de la saisie.
      deductibleAmount: t.freeAmount || t.amount == null
        ? null
        : eligibleReceiptAmount(Number(t.amount), t.receiptMode, t.ineligibleAmount != null ? Number(t.ineligibleAmount) : null)?.toString() ?? null,
      ineligibleAmount: t.freeAmount && t.ineligibleAmount != null ? Number(t.ineligibleAmount) : null,
    })),
    customFields: customFields.map(f => ({ id: f.id, type: f.type, label: f.label, required: f.required })),
  })
}
