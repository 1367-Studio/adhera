import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { generateRecuFiscalForCotisation } from "@/lib/pdf/recu-fiscal"
import { withPortalAuth } from "@/lib/api-wrapper"

type Params = {
  cotisationId: string
}

export const GET = withPortalAuth<Params>(async (_req, ctx, { cotisationId }) => {
  const cotisation = await prisma.cotisation.findFirst({
    where: { id: cotisationId, membreId: ctx.membreId!, associationId: ctx.associationId, paidAt: { not: null } },
  })
  if (!cotisation) return NextResponse.json({ error: "Cotisation introuvable ou non payée" }, { status: 404 })
  if (cotisation.receiptMode === "NONE")
    return NextResponse.json({ error: "Cette cotisation n'est pas éligible au reçu fiscal" }, { status: 403 })

  const membre = await prisma.membre.findUnique({
    where:  { id: ctx.membreId! },
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
