import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { buildDocumentPdf } from "@/lib/pdf/document-pdf"
import { resolveDocumentBranding } from "@/lib/plan-limits"

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const facture = await prisma.facture.findFirst({
    where:   { id, associationId, deletedAt: null },
    include: { items: { orderBy: { order: "asc" } }, fournisseur: true },
  })
  if (!facture) return NextResponse.json({ error: "Facture introuvable" }, { status: 404 })

  const association = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { name: true, address: true, city: true, siren: true, plan: true, customBrandingEnabled: true, logoUrl: true, primaryColor: true },
  })
  if (!association) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const pdf = await buildDocumentPdf({
    kind:           "FACTURE",
    number:         facture.number,
    issueDate:      facture.issueDate,
    secondaryLabel: "Échéance",
    secondaryDate:  facture.dueDate,
    association: { ...association, ...resolveDocumentBranding(association) },
    fournisseur: facture.fournisseur ? {
      companyName: facture.fournisseur.companyName,
      address:     facture.fournisseur.address,
      city:        facture.fournisseur.city,
      postalCode:  facture.fournisseur.postalCode,
      siret:       facture.fournisseur.siret,
      vatNumber:   facture.fournisseur.vatNumber,
    } : null,
    items: facture.items.map(i => ({
      description: i.description,
      quantity:    Number(i.quantity),
      unitPrice:   Number(i.unitPrice),
      vatRate:     Number(i.vatRate),
      discount:    Number(i.discount),
    })),
    subtotal:       Number(facture.subtotal),
    vatAmount:      Number(facture.vatAmount),
    discountAmount: Number(facture.discountAmount),
    total:          Number(facture.total),
    amountPaid:     Number(facture.amountPaid),
    notes:          facture.notes,
    paymentTerms:   facture.paymentTerms,
  })

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `inline; filename="${facture.number}.pdf"`,
    },
  })
}, { module: "factures" })
