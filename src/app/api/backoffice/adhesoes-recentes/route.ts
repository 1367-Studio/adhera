import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withSuperAdminAuth } from "@/lib/api-wrapper"

const ALLOWED_DAYS = [7, 30, 90] as const

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10) // "YYYY-MM-DD", UTC — stable bucket key
}

// New Membre rows within the window, counted regardless of how they were added —
// public adhésion forms (one-off, group, installments, recurring), a manager filling the
// form for someone, "Ajouter un membre" in the dashboard (with or without a tarif),
// self-registration on the portal, and a new association's own founding admin all create
// a Membre row and land here. `paidOnly` narrows to members who have at least one PAYE
// Cotisation — a manual add or portal self-registration is included in "tous" the same as
// a paid public signup, so the totals here can be higher than the old membershipFormId-only
// filter and are the reason a payer/non-payer split matters.
export const GET = withSuperAdminAuth(async (req) => {
  const url = new URL(req.url)
  const daysParam = url.searchParams.get("days")
  const days = ALLOWED_DAYS.includes(Number(daysParam) as typeof ALLOWED_DAYS[number])
    ? Number(daysParam)
    : 30
  const paidOnly = url.searchParams.get("paidOnly") === "1"

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
  const where = {
    createdAt: { gte: cutoff },
    ...(paidOnly ? { cotisations: { some: { status: "PAYE" as const } } } : {}),
  }

  const [grouped, recent] = await Promise.all([
    prisma.membre.groupBy({
      by:     ["associationId"],
      where,
      _count: { _all: true },
    }),
    // Raw rows for the daily trend below — bucketed in JS rather than a SQL date_trunc:
    // at most a few hundred rows even at the 90-day window, and it keeps this route on
    // plain Prisma instead of a raw query for what's really just a group-by-day count.
    prisma.membre.findMany({
      where,
      select: { createdAt: true },
    }),
  ])

  // Every day in the window gets a bucket, even ones with zero adhésions — otherwise the
  // trend line would silently skip quiet days instead of showing the dip.
  const countByDay = new Map<string, number>()
  for (let i = 0; i < days; i++) {
    countByDay.set(dayKey(new Date(cutoff.getTime() + i * 24 * 60 * 60 * 1000)), 0)
  }
  for (const m of recent) {
    const key = dayKey(m.createdAt)
    countByDay.set(key, (countByDay.get(key) ?? 0) + 1)
  }
  const daily = [...countByDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }))

  if (grouped.length === 0) {
    return NextResponse.json({ days, paidOnly, associations: [], daily })
  }

  const assocs = await prisma.association.findMany({
    where:  { id: { in: grouped.map(g => g.associationId) } },
    select: { id: true, name: true },
  })
  const nameById = new Map(assocs.map(a => [a.id, a.name]))

  const associations = grouped
    .map(g => ({ id: g.associationId, name: nameById.get(g.associationId) ?? "?", count: g._count._all }))
    .sort((a, b) => b.count - a.count)

  return NextResponse.json({ days, paidOnly, associations, daily })
})
