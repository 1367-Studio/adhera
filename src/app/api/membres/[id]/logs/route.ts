import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"

const DEFAULT_PAGE_SIZE = 20

export const GET = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId } = ctx

  const membre = await prisma.membre.findFirst({
    where:  { id, associationId },
    select: { id: true, userId: true },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const { searchParams } = new URL(req.url)
  const page     = Math.max(1, Number(searchParams.get("page")     ?? 1)                    || 1)
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE))

  const [participations, cotisations, materialLoans] = await Promise.all([
    prisma.participation.findMany({ where: { membreId: id }, select: { id: true } }),
    prisma.cotisation.findMany({ where: { membreId: id }, select: { id: true } }),
    prisma.materialLoan.findMany({ where: { membreId: id }, select: { id: true } }),
  ])
  const participationIds = participations.map(p => p.id)
  const cotisationIds     = cotisations.map(c => c.id)
  const materialLoanIds   = materialLoans.map(l => l.id)

  const where = {
    associationId,
    OR: [
      { entity: "Membre",        entityId: id },
      // The linked User's own account actions (name/email/password changes, role changes
      // made from the backoffice) never touch the Membre row itself, so without this they'd
      // be logged but invisible here — the one screen an admin actually checks when a
      // member's displayed name looks wrong.
      ...(membre.userId
        ? [{ entity: "User", entityId: membre.userId }]
        : []),
      ...(participationIds.length > 0
        ? [{ entity: "Participation", entityId: { in: participationIds } }]
        : []),
      ...(cotisationIds.length > 0
        ? [{ entity: "Cotisation", entityId: { in: cotisationIds } }]
        : []),
      ...(materialLoanIds.length > 0
        ? [{ entity: "MaterialLoan", entityId: { in: materialLoanIds } }]
        : []),
    ],
  }

  const [logs, total] = await Promise.all([
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip:    (page - 1) * pageSize,
      take:    pageSize,
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
    totalPages: Math.ceil(total / pageSize),
    pageSize,
  })
})
