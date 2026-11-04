import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withSuperAdminAuth } from "@/lib/api-wrapper"
import { mergeMembres, MergeMembresError } from "@/lib/membre-merge"
import { membreDuplicateMergeRequestSchema, type MembreDuplicateMergeResponse } from "@/lib/schemas"

export const POST = withSuperAdminAuth<{ id: string }>(async (req, { userId }, { id }) => {
  const parsed = membreDuplicateMergeRequestSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const match = await prisma.membreDuplicateMatch.findUnique({ where: { id } })
  if (!match) return NextResponse.json({ error: "Doublon introuvable" }, { status: 404 })
  if (match.status === "MERGED") return NextResponse.json({ error: "Ce doublon a déjà été fusionné" }, { status: 422 })

  const { primaryMembreId, fieldResolutions } = parsed.data
  if (primaryMembreId !== match.membreAId && primaryMembreId !== match.membreBId) {
    return NextResponse.json({ error: "Le membre principal doit être l'un des deux membres de ce doublon" }, { status: 422 })
  }
  const secondaryMembreId = primaryMembreId === match.membreAId ? match.membreBId : match.membreAId

  try {
    const result = await mergeMembres({
      // mergeMembres itself re-verifies both membres resolve to this exact associationId —
      // unlike the dashboard route (pre-scoped to one association via withAdminAuth), the
      // backoffice isn't, so this is the only place that boundary gets enforced.
      associationId:   match.associationId,
      primaryMembreId, secondaryMembreId,
      fieldResolutions,
      performedById: userId,
    })
    return NextResponse.json(result satisfies MembreDuplicateMergeResponse)
  } catch (err) {
    if (err instanceof MergeMembresError) return NextResponse.json({ error: err.message }, { status: err.status })
    throw err
  }
})
