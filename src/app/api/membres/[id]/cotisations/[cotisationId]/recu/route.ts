import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { generateRecuFiscalForCotisation } from "@/lib/pdf/recu-fiscal"
import { withAdminAuth } from "@/lib/api-wrapper"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export const GET = withAdminAuth<{ id: string; cotisationId: string }>(async (_req, ctx, { id, cotisationId }) => {
  if (!FINANCE.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const cotisation = await prisma.cotisation.findFirst({
    where: { id: cotisationId, membreId: id, associationId: ctx.associationId, paidAt: { not: null } },
  })
  if (!cotisation) return NextResponse.json({ error: "Cotisation introuvable ou non payée" }, { status: 404 })
  // Snapshotted from MembershipTier.taxReceiptEligible at creation (see schema.prisma) — a
  // cotisation created any other way (admin manual add, legacy /inscription) never has it set.
  if (!cotisation.taxReceiptEligible)
    return NextResponse.json({ error: "Cette cotisation n'est pas éligible au reçu fiscal" }, { status: 403 })

  const membre = await prisma.membre.findUnique({
    where:  { id },
    select: { firstName: true, lastName: true, address: true },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: {
      id: true, name: true, address: true, city: true,
      siren: true, rna: true, canIssueTaxReceipts: true,
      objet: true, organismeCategory: true, organismeCategoryDetail: true,
    },
  })
  if (!assoc || !assoc.canIssueTaxReceipts)
    return NextResponse.json({ error: "Reçu fiscal non activé pour cette association" }, { status: 403 })

  const pdf  = await generateRecuFiscalForCotisation(cotisation, membre, assoc)
  const name = `recu-fiscal-${cotisation.receiptNumber ?? cotisation.id}.pdf`

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  })
})
