import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { buildDocumentPdf } from "@/lib/pdf/document-pdf"
import { resolveDocumentBranding } from "@/lib/plan-limits"

const ALLOWED = ["ADMIN", "PRESIDENT", "SECRETAIRE", "TRESORIER"]

export const GET = withAdminAuth<{ id: string; loanId: string }>(async (_req, ctx, { id, loanId }) => {
  const { associationId } = ctx

  const loan = await prisma.materialLoan.findFirst({
    where:   { id: loanId, materialId: id, material: { associationId } },
    include: { material: true, membre: { select: { firstName: true, lastName: true, email: true } } },
  })
  if (!loan) return NextResponse.json({ error: "Prêt introuvable" }, { status: 404 })

  const association = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { name: true, address: true, city: true, siren: true, website: true, iban: true, bic: true, plan: true, customBrandingEnabled: true, logoUrl: true, primaryColor: true },
  })
  if (!association) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const borrowerName = loan.membre ? `${loan.membre.firstName} ${loan.membre.lastName}` : (loan.borrowerName ?? "Externe")
  const unitPrice     = Number(loan.feeAmount ?? 0)
  const number        = `PRET-${loan.id.slice(-8).toUpperCase()}`

  const pdf = await buildDocumentPdf({
    kind:           "MATERIEL_LOAN",
    number,
    issueDate:      loan.borrowedAt,
    secondaryLabel: "Retour prévu",
    secondaryDate:  loan.expectedReturnAt,
    association: { ...association, ...resolveDocumentBranding(association) },
    fournisseur: {
      companyName: borrowerName,
      address:     null,
      city:        null,
      postalCode:  null,
      siret:       null,
      vatNumber:   null,
    },
    items: [{
      description: loan.material.name + (loan.notes ? ` — ${loan.notes}` : ""),
      quantity:    loan.quantity,
      unitPrice,
      vatRate:     0,
      discount:    0,
    }],
    subtotal:       loan.quantity * unitPrice,
    vatAmount:      0,
    discountAmount: 0,
    total:          loan.quantity * unitPrice,
    notes:          null,
    paymentTerms:   null,
  })

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `inline; filename="${number}.pdf"`,
    },
  })
}, { roles: ALLOWED, module: "materiel" })
