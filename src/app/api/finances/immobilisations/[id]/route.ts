// src/app/api/finances/immobilisations/[id]/route.ts
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { immobilisationUpdateSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const immobilisation = await prisma.immobilisation.findFirst({
    where:   { id, associationId },
    include: {
      depreciations: { orderBy: { exercice: { startDate: "asc" } }, include: { exercice: { select: { id: true, label: true } } } },
      expense:       { select: { id: true, description: true, vendor: true, date: true } },
    },
  })
  if (!immobilisation) return NextResponse.json({ error: "Immobilisation introuvable" }, { status: 404 })
  return NextResponse.json(immobilisation)
}, { area: "comptabilite", module: "finances" })

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.immobilisation.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Immobilisation introuvable" }, { status: 404 })

  const body   = await req.json()
  const parsed = immobilisationUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }
  const { label, disposalDate } = parsed.data

  // Data only, no posting side effect — see Immobilisation.disposalDate's own doc comment,
  // a disposal/write-off journal entry is explicitly out of scope for Fase 2.
  if (disposalDate !== undefined && disposalDate !== null && new Date(disposalDate) < existing.usageStartDate) {
    return NextResponse.json({ error: "La date de cession ne peut pas précéder la mise en service." }, { status: 422 })
  }

  const immobilisation = await prisma.immobilisation.update({
    where: { id },
    data: {
      ...(label !== undefined ? { label } : {}),
      ...(disposalDate !== undefined ? { disposalDate: disposalDate ? new Date(disposalDate) : null } : {}),
    },
  })

  await writeActivityLog({
    associationId, actorId: userId, action: "IMMOBILISATION_UPDATED",
    entity: "Immobilisation", entityId: id, label: immobilisation.label,
  })
  return NextResponse.json(immobilisation)
}, { area: "comptabilite", module: "finances" })

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.immobilisation.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Immobilisation introuvable" }, { status: 404 })

  // ImmobilisationDepreciation.immobilisationId is onDelete: Restrict — once a dotation has
  // been posted, this asset's history is part of the ledger and can't be silently dropped.
  const depreciationCount = await prisma.immobilisationDepreciation.count({ where: { immobilisationId: id } })
  if (depreciationCount > 0) {
    return NextResponse.json({
      error: `Impossible de supprimer : ${depreciationCount} dotation(s) aux amortissements déjà comptabilisée(s) pour cette immobilisation.`,
    }, { status: 409 })
  }

  await prisma.immobilisation.delete({ where: { id } })

  await writeActivityLog({
    associationId, actorId: userId, action: "IMMOBILISATION_DELETED",
    entity: "Immobilisation", entityId: id, label: existing.label,
  })
  return new NextResponse(null, { status: 204 })
}, { area: "comptabilite", module: "finances" })
