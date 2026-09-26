import { NextResponse } from "next/server"
import { getLocale } from "next-intl/server"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"
import { evenementNotOverWhere, evenementOverWhere } from "@/lib/evenement-timing"
import { enrichPortalEvenements, portalEvenementInclude } from "@/lib/portal-evenements"
import type { Locale } from "@/i18n/locales"

export const GET = withPortalAuth(async (_req, ctx) => {
  const { associationId, userId } = ctx

  const now     = new Date()
  const include = portalEvenementInclude(userId)

  const LIMIT = 10

  const [upcomingRaw, pastRaw] = await Promise.all([
    prisma.evenement.findMany({
      // No visibility filter here (unlike the public site route) — PRIVATE means "portal
      // only, not on the public site/link", so a member should still see it. DRAFT is
      // excluded either way: an admin still configuring the event isn't done announcing it.
      where:   { associationId, status: "PUBLISHED", ...evenementNotOverWhere(now) },
      orderBy: { date: "asc" },
      take:    LIMIT + 1,
      include,
    }),
    prisma.evenement.findMany({
      where:   { associationId, status: "PUBLISHED", ...evenementOverWhere(now) },
      orderBy: { date: "desc" },
      take:    LIMIT + 1,
      include,
    }),
  ])

  const upcomingHasMore = upcomingRaw.length > LIMIT
  const pastHasMore     = pastRaw.length     > LIMIT
  const upcoming        = upcomingRaw.slice(0, LIMIT)
  const past            = pastRaw.slice(0, LIMIT)

  const locale   = (await getLocale()) as Locale
  const enriched = await enrichPortalEvenements([...upcoming, ...past], associationId, locale)

  return NextResponse.json({
    upcoming:        enriched.slice(0, upcoming.length),
    past:            enriched.slice(upcoming.length),
    upcomingHasMore,
    pastHasMore,
  })
}, { requireMembre: false })
