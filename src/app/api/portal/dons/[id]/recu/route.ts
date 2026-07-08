import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { generateRecuFiscalForDon } from "@/lib/pdf/recu-fiscal"
import { withPortalAuth } from "@/lib/api-wrapper"

type Params = { id: string }

export const GET = withPortalAuth<Params>(async (_req, ctx, { id }) => {
  const don = await prisma.don.findFirst({
    where: { id, membreId: ctx.membreId!, associationId: ctx.associationId, paidAt: { not: null }, refundedAt: null },
  })
  if (!don) return NextResponse.json({ error: "Don introuvable ou remboursé" }, { status: 404 })

  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: {
      id: true, name: true, address: true, city: true,
      siren: true, rna: true, canIssueTaxReceipts: true,
      objet: true, organismeCategory: true, organismeCategoryDetail: true,
    },
  })
  if (!assoc || !assoc.canIssueTaxReceipts)
    return NextResponse.json({ error: "Reçu fiscal non disponible" }, { status: 403 })

  const pdf  = await generateRecuFiscalForDon(don, assoc)
  const name = `recu-fiscal-${don.receiptNumber ?? don.id}.pdf`

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  })
})
