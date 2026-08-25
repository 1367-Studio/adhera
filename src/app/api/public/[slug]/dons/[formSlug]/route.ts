import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"
import { connectAccountChargesEnabled } from "@/lib/stripe"

export async function GET(
  _req: Request,
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

  const form = await prisma.donationForm.findFirst({
    where: { slug: formSlug, associationId: assoc.id, status: "PUBLISHED", visibility: { not: "PRIVATE" } },
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

  return NextResponse.json({
    associationName:     assoc.name,
    id:                  form.id,
    title:               form.title,
    imageUrl:            form.imageUrl,
    description:         form.description,
    conditions:          form.conditions,
    requireCguvSignature: form.requireCguvSignature,
    contactEmail:        form.contactEmail,
    contactPhone:        form.contactPhone,
    fieldAddress:        form.fieldAddress,
    fieldBirthDate:      form.fieldBirthDate,
    fieldPhone:          form.fieldPhone,
    fieldMobile:         form.fieldMobile,
    fieldGender:         form.fieldGender,
    confirmationMessage: form.confirmationMessage,
    offlineInstructions: form.offlineInstructions,
    allowCash:           form.allowCash,
    allowCheque:         form.allowCheque,
    allowTransfer:       form.allowTransfer,
    notOpenYet,
    closed,
    paymentEnabled,
    canIssueTaxReceipts: assoc.canIssueTaxReceipts,
    tiers: form.tiers.map(t => ({
      id: t.id, label: t.label, kind: t.kind, interval: t.interval, freeAmount: t.freeAmount,
      amount: t.amount?.toString() ?? null, receiptMode: t.receiptMode,
      deductibleAmount: t.deductibleAmount?.toString() ?? null,
    })),
    customFields: form.customFields.map(f => ({ id: f.id, type: f.type, label: f.label, required: f.required })),
  })
}
