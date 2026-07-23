import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { generateDeclarationCotisation } from "@/lib/pdf/declaration-cotisation"
import { withPortalAuth } from "@/lib/api-wrapper"

type Params = {
  cotisationId: string
}

export const GET = withPortalAuth<Params>(async (_req, ctx, { cotisationId }) => {

  const cotisation = await prisma.cotisation.findFirst({
    where: { id: cotisationId, membreId: ctx.membreId!, associationId: ctx.associationId, status: "PAYE" },

  })
  if (!cotisation) return NextResponse.json({ error: "Cotisation introuvable ou non payée" }, { status: 404 })

  const membre = await prisma.membre.findUnique({
    where:  { id: ctx.membreId! },
    select: { firstName: true, lastName: true, address: true },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { id: true, name: true, address: true, city: true },
  })
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const pdf  = await generateDeclarationCotisation(cotisation, membre, assoc)
  const name = `declaration-cotisation-${cotisation.declarationNumber ?? cotisation.id}.pdf`

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  })
})
