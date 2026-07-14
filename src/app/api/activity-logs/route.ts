import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"

const PAGE_SIZE = 50
const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const { searchParams } = new URL(req.url)
  const page          = Math.max(1, Number(searchParams.get("page") ?? 1) || 1)
  const action        = searchParams.get("action")        ?? undefined
  const entity        = searchParams.get("entity")        ?? undefined
  const entityId      = searchParams.get("entityId")      ?? undefined
  const actorId       = searchParams.get("actorId")       ?? undefined
  const fournisseurId = searchParams.get("fournisseurId") ?? undefined
  const from          = searchParams.get("from")
  const to            = searchParams.get("to")

  const toDate = to ? new Date(to) : null
  if (toDate) toDate.setUTCHours(23, 59, 59, 999)

  // A fournisseur's own history entries (FOURNISSEUR_*) only cover its own record — the
  // Devis/Facture/FactureRecue created against it are logged under their own entity/id,
  // never the fournisseur's. `fournisseurId` aggregates all of those into one timeline so
  // the "Historique" tab on the fournisseur page actually shows everything that happened
  // around it, not just edits to the contact card. Soft-deleted related documents are
  // included on purpose — their history shouldn't vanish just because the record did.
  let entityFilter: Record<string, unknown> = {
    ...(entity   && { entity }),
    ...(entityId && { entityId }),
  }
  if (fournisseurId) {
    const [devis, factures, documents] = await Promise.all([
      prisma.devis.findMany({ where: { fournisseurId }, select: { id: true } }),
      prisma.facture.findMany({ where: { fournisseurId }, select: { id: true } }),
      prisma.factureRecue.findMany({ where: { fournisseurId }, select: { id: true } }),
    ])
    entityFilter = {
      OR: [
        { entity: "Fournisseur", entityId: fournisseurId },
        { entity: "Devis",        entityId: { in: devis.map(d => d.id) } },
        { entity: "Facture",      entityId: { in: factures.map(f => f.id) } },
        { entity: "FactureRecue", entityId: { in: documents.map(d => d.id) } },
      ],
    }
  }

  const where = {
    associationId,
    ...entityFilter,
    ...(action  && { action }),
    ...(actorId && { actorId }),
    ...((from || to) && {
      createdAt: {
        ...(from   && { gte: new Date(from) }),
        ...(toDate && { lte: toDate }),
      },
    }),
  }

  const [logs, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip:    (page - 1) * PAGE_SIZE,
      take:    PAGE_SIZE,
    }),
    prisma.activityLog.count({ where }),
  ])

  const actorIds = [...new Set(logs.map(l => l.actorId).filter(Boolean) as string[])]
  const actors   = actorIds.length > 0
    ? await prisma.user.findMany({
        where:  { id: { in: actorIds } },
        select: { id: true, name: true, email: true },
      })
    : []
  const actorMap = Object.fromEntries(actors.map(u => [u.id, u.name ?? u.email ?? u.id]))

  const enriched = logs.map(l => ({
    ...l,
    actorName: l.actorId ? (actorMap[l.actorId] ?? null) : null,
  }))

  return NextResponse.json({
    data:       enriched,
    total,
    page,
    totalPages: Math.ceil(total / PAGE_SIZE),
    pageSize:   PAGE_SIZE,
  })
}, { roles: MANAGERS })
