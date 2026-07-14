import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

// Payments only exist through Factures, so this is gated on the "factures" module rather
// than "fournisseurs" — a fournisseur page with Factures disabled has nothing to show here.
export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const payments = await prisma.facturePayment.findMany({
    where:   { facture: { fournisseurId: id, associationId, deletedAt: null } },
    include: { facture: { select: { id: true, number: true } } },
    orderBy: { paidAt: "desc" },
  })

  return NextResponse.json(payments)
}, { roles: MANAGERS, module: "factures" })
