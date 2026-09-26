import { NextResponse } from "next/server"
import { getLocale } from "next-intl/server"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"
import { enrichPortalEvenements, portalEvenementInclude } from "@/lib/portal-evenements"
import type { Locale } from "@/i18n/locales"

type Params = { id: string }

export const GET = withPortalAuth<Params>(async (_req, ctx, { id: evenementId }) => {
  const { associationId, userId } = ctx

  // Same visibility rule as the list route: PRIVATE stays visible in the portal, DRAFT does not.
  const evenement = await prisma.evenement.findFirst({
    where:   { id: evenementId, associationId, status: "PUBLISHED" },
    include: portalEvenementInclude(userId),
  })
  if (!evenement) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const locale     = (await getLocale()) as Locale
  const [enriched] = await enrichPortalEvenements([evenement], associationId, locale)

  return NextResponse.json({ evenement: enriched })
}, { requireMembre: false })
