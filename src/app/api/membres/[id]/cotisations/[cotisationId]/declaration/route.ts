import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { generateDeclarationCotisation } from "@/lib/pdf/declaration-cotisation"
import { withAdminAuth } from "@/lib/api-wrapper"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export const GET = withAdminAuth<{ id: string; cotisationId: string }>(async (_req, ctx, { id, cotisationId }) => {
  if (!FINANCE.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const cotisation = await prisma.cotisation.findFirst({
    where: { id: cotisationId, membreId: id, associationId: ctx.associationId, status: "PAYE" },
  })
  if (!cotisation) return NextResponse.json({ error: "Cotisation introuvable ou non payée" }, { status: 404 })
  const { paidAt } = cotisation
  if (!paidAt) return NextResponse.json({ error: "Cotisation payée sans date de paiement enregistrée" }, { status: 422 })

  const membre = await prisma.membre.findUnique({
    where:  { id },
    select: { firstName: true, lastName: true, address: true },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { id: true, name: true, address: true, city: true },
  })
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const { pdf, declarationNumber } = await generateDeclarationCotisation({ ...cotisation, paidAt }, membre, assoc)
  const name = `declaration-cotisation-${declarationNumber}.pdf`

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type":        "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
    },
  })
})
