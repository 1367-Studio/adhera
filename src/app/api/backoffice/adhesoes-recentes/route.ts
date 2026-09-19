import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withSuperAdminAuth } from "@/lib/api-wrapper"

const ALLOWED_DAYS = [7, 30, 90] as const

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10) // "YYYY-MM-DD", UTC — stable bucket key
}

// New Membre rows within the window that came from a public MembershipForm signup —
// filtered on Membre.createdAt, not Cotisation.createdAt, because a recurring
// CotisationSubscription's renewal-year Cotisation also carries membershipFormId (copied
// at signup, see handleCotisationInvoicePaid) even though it isn't a new adhésion, just an
// existing member's yearly charge. Membre.createdAt only moves once, at real signup time.
export const GET = withSuperAdminAuth(async (req) => {
  const daysParam = new URL(req.url).searchParams.get("days")
  const days = ALLOWED_DAYS.includes(Number(daysParam) as typeof ALLOWED_DAYS[number])
    ? Number(daysParam)
    : 30

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const [grouped, recent] = await Promise.all([
    prisma.membre.groupBy({
      by:     ["associationId"],
      where:  { createdAt: { gte: cutoff }, cotisations: { some: { membershipFormId: { not: null } } } },
      _count: { _all: true },
    }),
    // Raw rows for the daily trend below — bucketed in JS rather than a SQL date_trunc:
    // at most a few hundred rows even at the 90-day window, and it keeps this route on
    // plain Prisma instead of a raw query for what's really just a group-by-day count.
    prisma.membre.findMany({
      where:  { createdAt: { gte: cutoff }, cotisations: { some: { membershipFormId: { not: null } } } },
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
    return NextResponse.json({ days, associations: [], daily })
  }

  const assocs = await prisma.association.findMany({
    where:  { id: { in: grouped.map(g => g.associationId) } },
    select: { id: true, name: true },
  })
  const nameById = new Map(assocs.map(a => [a.id, a.name]))

  const associations = grouped
    .map(g => ({ id: g.associationId, name: nameById.get(g.associationId) ?? "?", count: g._count._all }))
    .sort((a, b) => b.count - a.count)

  return NextResponse.json({ days, associations, daily })
})
