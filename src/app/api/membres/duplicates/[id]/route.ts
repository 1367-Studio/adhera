import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { countMembreRelations, previewMergeConflicts } from "@/lib/membre-duplicate-matches"
import { membreDuplicateMatchPatchSchema, type MembreDuplicateDetail } from "@/lib/schemas"

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const match = await prisma.membreDuplicateMatch.findFirst({
    where:   { id, associationId: ctx.associationId },
    // `type` is included so the compare screen can show the membership type's name instead
    // of the raw typeId when that field differs between the two members.
    include: { membreA: { include: { type: { select: { name: true } } } }, membreB: { include: { type: { select: { name: true } } } } },
  })
  if (!match) return NextResponse.json({ error: "Doublon introuvable" }, { status: 404 })

  const [relationCountsA, relationCountsB, potentialConflicts] = await Promise.all([
    countMembreRelations(match.membreAId),
    countMembreRelations(match.membreBId),
    previewMergeConflicts(match.membreAId, match.membreBId),
  ])

  const response: MembreDuplicateDetail = {
    id:            match.id,
    status:        match.status,
    matchedFields: match.matchedFields,
    membreA:       match.membreA,
    membreB:       match.membreB,
    relationCounts: { membreA: relationCountsA, membreB: relationCountsB },
    potentialConflicts,
  }
  return NextResponse.json(response)
}, { area: "membres" })

// Dismiss ("Ignorer ce doublon") or restore a previously dismissed pair back to PENDING.
export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const parsed = membreDuplicateMatchPatchSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const existing = await prisma.membreDuplicateMatch.findFirst({ where: { id, associationId: ctx.associationId } })
  if (!existing) return NextResponse.json({ error: "Doublon introuvable" }, { status: 404 })
  if (existing.status === "MERGED") return NextResponse.json({ error: "Ce doublon a déjà été fusionné" }, { status: 422 })

  const updated = await prisma.membreDuplicateMatch.update({
    where: { id },
    data: parsed.data.status === "DISMISSED"
      ? { status: "DISMISSED", autoDismissed: false, dismissedAt: new Date(), dismissedById: ctx.userId }
      : { status: "PENDING", autoDismissed: false, dismissedAt: null, dismissedById: null },
  })
  return NextResponse.json({ status: updated.status })
}, { area: "membres" })
