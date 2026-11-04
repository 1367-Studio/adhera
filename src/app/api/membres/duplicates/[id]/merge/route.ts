import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { mergeMembres, MergeMembresError } from "@/lib/membre-merge"
import { membreDuplicateMergeRequestSchema, type MembreDuplicateMergeResponse } from "@/lib/schemas"

export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const parsed = membreDuplicateMergeRequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const match = await prisma.membreDuplicateMatch.findFirst({ where: { id, associationId: ctx.associationId } })
  if (!match) return NextResponse.json({ error: "Doublon introuvable" }, { status: 404 })
  if (match.status === "MERGED") return NextResponse.json({ error: "Ce doublon a déjà été fusionné" }, { status: 422 })

  const { primaryMembreId, fieldResolutions } = parsed.data
  if (primaryMembreId !== match.membreAId && primaryMembreId !== match.membreBId) {
    return NextResponse.json({ error: "Le membre principal doit être l'un des deux membres de ce doublon" }, { status: 422 })
  }
  const secondaryMembreId = primaryMembreId === match.membreAId ? match.membreBId : match.membreAId

  try {
    const result = await mergeMembres({
      associationId:   ctx.associationId,
      primaryMembreId, secondaryMembreId,
      fieldResolutions,
      performedById: ctx.userId,
    })
    return NextResponse.json(result satisfies MembreDuplicateMergeResponse)
  } catch (err) {
    if (err instanceof MergeMembresError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
}, { area: "membres" })
