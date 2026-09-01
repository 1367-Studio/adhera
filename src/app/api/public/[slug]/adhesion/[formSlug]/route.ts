import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
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
      products: {
        orderBy: { order: "asc" },
        include: {
          variante: {
            select: {
              id: true, label: true, price: true, stock: true,
              produit: { select: { id: true, name: true, status: true, imageUrl: true } },
            },
          },
        },
      },
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
      receiptMode: t.receiptMode,
      // Montant fixe : le montant éligible est déjà calculable ici (montant payé = t.amount).
      // Montant libre : pas de montant payé encore connu — ineligibleAmount brut est exposé à
      // la place, pour que le formulaire public recalcule en direct au fur et à mesure que le
      // visiteur saisit son montant (voir eligibleReceiptAmount côté composant).
      deductibleAmount: t.freeAmount || t.amount == null
        ? null
        : eligibleReceiptAmount(Number(t.amount), t.receiptMode, t.ineligibleAmount != null ? Number(t.ineligibleAmount) : null)?.toString() ?? null,
      ineligibleAmount: t.freeAmount && t.ineligibleAmount != null ? Number(t.ineligibleAmount) : null,
    })),
    customFields: form.customFields.map(f => ({ id: f.id, type: f.type, label: f.label, required: f.required })),
    // Un produit archivé après avoir été lié au formulaire n'est pas retiré de
    // MembershipFormProduct (voir products/route.ts) — filtré ici plutôt, à la lecture,
    // même logique que le statut des tiers. Si le module Boutique a été désactivé depuis
    // (l'admin ne peut plus le reconfigurer, voir products/route.ts), les offres existantes
    // ne doivent pas non plus rester achetables publiquement — sinon désactiver le module
    // n'aurait aucun effet sur ce formulaire.
    products: !modules.boutique ? [] : form.products
      .filter(p => p.variante.produit.status === "ACTIVE")
      .map(p => ({
        id:              p.id,
        varianteId:      p.variante.id,
        variantLabel:    p.variante.label,
        price:           p.variante.price,
        stock:           p.variante.stock,
        productId:       p.variante.produit.id,
        productName:     p.variante.produit.name,
        productImageUrl: p.variante.produit.imageUrl,
      })),
  })
}
