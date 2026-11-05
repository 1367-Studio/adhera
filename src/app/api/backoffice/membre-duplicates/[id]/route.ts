import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withSuperAdminAuth } from "@/lib/api-wrapper"
import { countMembreRelations, previewMergeConflicts } from "@/lib/membre-duplicate-matches"
import { membreDuplicateMatchPatchSchema, type MembreDuplicateDetail } from "@/lib/schemas"

export const GET = withSuperAdminAuth<{ id: string }>(async (_req, _ctx, { id }) => {
  const match = await prisma.membreDuplicateMatch.findUnique({
    where:   { id },
    include: {
      membreA:     { include: { type: { select: { name: true } } } },
      membreB:     { include: { type: { select: { name: true } } } },
      association: { select: { name: true, slug: true } },
    },
  })
  if (!match) return NextResponse.json({ error: "Doublon introuvable" }, { status: 404 })

  const [relationCountsA, relationCountsB, potentialConflicts] = await Promise.all([
    countMembreRelations(match.membreAId),
    countMembreRelations(match.membreBId),
    previewMergeConflicts(match.membreAId, match.membreBId),
  ])

  const response: MembreDuplicateDetail & { associationName: string } = {
    id:              match.id,
    status:          match.status,
    matchedFields:   match.matchedFields,
    membreA:         match.membreA,
    membreB:         match.membreB,
    relationCounts:  { membreA: relationCountsA, membreB: relationCountsB },
    potentialConflicts,
    associationName: match.association.name,
  }
  return NextResponse.json(response)
})

export const PATCH = withSuperAdminAuth<{ id: string }>(async (req, { userId }, { id }) => {
  const parsed = membreDuplicateMatchPatchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const existing = await prisma.membreDuplicateMatch.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Doublon introuvable" }, { status: 404 })
  if (existing.status === "MERGED") return NextResponse.json({ error: "Ce doublon a déjà été fusionné" }, { status: 422 })

  const updated = await prisma.membreDuplicateMatch.update({
    where: { id },
    data: parsed.data.status === "DISMISSED"
      ? { status: "DISMISSED", autoDismissed: false, dismissedAt: new Date(), dismissedById: userId }
      : { status: "PENDING", autoDismissed: false, dismissedAt: null, dismissedById: null },
  })
  return NextResponse.json({ status: updated.status })
})
