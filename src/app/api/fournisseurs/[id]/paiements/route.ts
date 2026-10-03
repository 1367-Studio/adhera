import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"

// Payments only exist through Factures, so this is gated on the "factures" module rather
// than "fournisseurs" — a fournisseur page with Factures disabled has nothing to show here.
// Comptabilité area (FORM-34). The old allowlist also let the Secrétaire in, although the sidebar
// only showed Fournisseurs to the finance roles; she now has no access here.
export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const payments = await prisma.facturePayment.findMany({
    where:   { facture: { fournisseurId: id, associationId, deletedAt: null } },
    include: { facture: { select: { id: true, number: true } } },
    orderBy: { paidAt: "desc" },
  })

  return NextResponse.json(payments)
}, { area: "comptabilite", module: "factures" })
