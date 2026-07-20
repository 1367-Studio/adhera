import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { computeDocumentTotals } from "@/lib/devis-calc"
import { nextFactureNumber } from "@/lib/document-numbering"
import { guardModule } from "@/lib/auth/require-module"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export const POST = withAdminAuth<{ id: string; loanId: string }>(async (_req, ctx, { id, loanId }) => {
  const { associationId, userId } = ctx

  // withAdminAuth's `module` option only takes one key, but a generated facture is unusable
  // without the Factures module — its only payment path (paiements/route.ts) hard-requires
  // it — so this second gate here avoids creating an invoice nobody can ever collect on.
  const facturesGuard = await guardModule(associationId, "factures")
  if (facturesGuard) return facturesGuard

  const loan = await prisma.materialLoan.findFirst({
    where:   { id: loanId, materialId: id, material: { associationId } },
    include: { material: true, membre: { select: { firstName: true, lastName: true } }, facture: true },
  })
  if (!loan) return NextResponse.json({ error: "Prêt introuvable" }, { status: 404 })
  if (loan.facture) return NextResponse.json({ error: "Ce prêt a déjà une facture" }, { status: 409 })
  const feeAmount = Number(loan.feeAmount ?? 0)
  if (feeAmount <= 0) return NextResponse.json({ error: "Ce prêt n'a pas de montant à facturer" }, { status: 422 })

  const borrowerName = loan.membre ? `${loan.membre.firstName} ${loan.membre.lastName}` : (loan.borrowerName ?? "Externe")
  const period = loan.returnedAt
    ? `du ${loan.borrowedAt.toLocaleDateString("fr-FR")} au ${loan.returnedAt.toLocaleDateString("fr-FR")}`
    : `à partir du ${loan.borrowedAt.toLocaleDateString("fr-FR")}`

  const items = [{
    description: `Prêt matériel — ${loan.material.name} — ${borrowerName} (${period})`,
    quantity:    loan.quantity,
    unitPrice:   feeAmount,
    vatRate:     0,
    discount:    0,
  }]
  const totals = computeDocumentTotals(items)

  for (let attempt = 0; attempt < 5; attempt++) {
    const number = await nextFactureNumber(associationId)
    try {
      const facture = await prisma.facture.create({
        data: {
          associationId,
          materialLoanId: loan.id,
          number,
          status:    "EN_ATTENTE",
          issueDate: new Date(),
          ...totals,
          items: { create: items.map((item, order) => ({ ...item, order })) },
        },
        include: { items: true },
      })

      await writeActivityLog({
        associationId, actorId: userId,
        action:   "FACTURE_CREATED",
        entity:   "Facture",
        entityId: facture.id,
        label:    `${facture.number} — ${loan.material.name}`,
      })

      return NextResponse.json(facture, { status: 201 })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue
      throw err
    }
  }

  return NextResponse.json({ error: "Impossible de générer un numéro de facture, réessayez" }, { status: 500 })
}, { roles: FINANCE, module: "materiel" })
