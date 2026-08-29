import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"
import { connectAccountChargesEnabled } from "@/lib/stripe"
import { canPreviewForm } from "@/lib/form-preview"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; formSlug: string }> },
) {
  const { slug, formSlug } = await params

  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: { id: true, name: true, modules: true, stripeConnectId: true },
  })
  if (!assoc) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const modules = parseModules(assoc.modules)
  if (!modules.cotisations) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const preview = await canPreviewForm(req, assoc.id)
  const form = await prisma.membershipForm.findFirst({
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

  const now        = new Date()
  const notOpenYet = !!form.opensAt && form.opensAt > now
  const closed      = !!form.closesAt && form.closesAt < now

  // Informational only (drives whether paid tiers render as payable) — the checkout route
  // re-checks for real before any money moves, same convention as the Dons public route.
  let paymentEnabled = false
  if (assoc.stripeConnectId) {
    try {
      paymentEnabled = await connectAccountChargesEnabled(assoc.stripeConnectId)
    } catch (err) {
      console.error(`[public-membership-form] failed to check payment availability for ${slug}/${formSlug}:`, err)
    }
  }

  return NextResponse.json({
    associationName:      assoc.name,
    id:                   form.id,
    title:                form.title,
    imageUrl:             form.imageUrl,
    description:          form.description,
    conditions:           form.conditions,
    attachments:           form.attachments ?? [],
    requireCguvSignature: form.requireCguvSignature,
    contactEmail:         form.contactEmail,
    contactPhone:         form.contactPhone,
    validationMode:       form.validationMode,
    fieldAddress:         form.fieldAddress,
    fieldBirthDate:       form.fieldBirthDate,
    fieldPhone:           form.fieldPhone,
    fieldMobile:          form.fieldMobile,
    fieldGender:          form.fieldGender,
    fieldPhoto:           form.fieldPhoto,
    fieldLanguage:        form.fieldLanguage,
    confirmationMessage:  form.confirmationMessage,
    offlineInstructions:  form.offlineInstructions,
    allowCash:            form.allowCash,
    allowCheque:          form.allowCheque,
    allowTransfer:        form.allowTransfer,
    notOpenYet,
    closed,
    paymentEnabled,
    tiers: form.tiers.map(t => ({
      id: t.id, label: t.label, itemType: t.itemType, kind: t.kind, free: t.free, freeAmount: t.freeAmount,
      amount: t.amount?.toString() ?? null, durationMonths: t.durationMonths,
      fixedPeriodEnd: t.fixedPeriodEnd?.toISOString() ?? null,
      installmentsAllowed: t.installmentsAllowed, installmentsCount: t.installmentsCount,
    })),
    customFields: form.customFields.map(f => ({ id: f.id, type: f.type, label: f.label, required: f.required })),
  })
}
