import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { buildDocumentPdf } from "@/lib/pdf/document-pdf"
import { resolveDocumentBranding } from "@/lib/plan-limits"

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const devis = await prisma.devis.findFirst({
    where:   { id, associationId, deletedAt: null },
    include: { items: { orderBy: { order: "asc" } }, fournisseur: true },
  })
  if (!devis) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 })

  const association = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { name: true, address: true, city: true, siren: true, website: true, iban: true, bic: true, plan: true, customBrandingEnabled: true, logoUrl: true, primaryColor: true },
  })
  if (!association) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const pdf = await buildDocumentPdf({
    kind:           "DEVIS",
    number:         devis.number,
    issueDate:      devis.issueDate,
    secondaryLabel: "Valide jusqu'au",
    secondaryDate:  devis.validUntil,
    association: { ...association, ...resolveDocumentBranding(association) },
    fournisseur: devis.fournisseur ? {
      companyName: devis.fournisseur.companyName,
      address:     devis.fournisseur.address,
      city:        devis.fournisseur.city,
      postalCode:  devis.fournisseur.postalCode,
      siret:       devis.fournisseur.siret,
      vatNumber:   devis.fournisseur.vatNumber,
    } : null,
    items: devis.items.map(i => ({
      description: i.description,
      quantity:    Number(i.quantity),
      unitPrice:   Number(i.unitPrice),
      vatRate:     Number(i.vatRate),
      discount:    Number(i.discount),
    })),
    subtotal:       Number(devis.subtotal),
    vatAmount:      Number(devis.vatAmount),
    discountAmount: Number(devis.discountAmount),
    total:          Number(devis.total),
    notes:          devis.notes,
    paymentTerms:   devis.paymentTerms,
  })

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `inline; filename="${devis.number}.pdf"`,
    },
  })
}, { module: "devis" })
