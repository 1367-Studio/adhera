import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { resolveHelpLocale } from "@/lib/help/locale"
import { sanityFetch } from "@/sanity/fetch"
import { HELP_NEWS_POPUP_QUERY } from "@/sanity/queries"
import type { NewsPopupEntry } from "@/sanity/types"
import { reportError } from "@/lib/monitoring"

// Older entries never pop up, even if a user has not seen them yet.
const NEWS_POPUP_MAX_AGE_DAYS = 90

export const GET = withAdminAuth(async () => {
  const locale = await resolveHelpLocale()

  const sinceDate = new Date()
  sinceDate.setUTCDate(sinceDate.getUTCDate() - NEWS_POPUP_MAX_AGE_DAYS)
  const since = sinceDate.toISOString().slice(0, 10)

  try {
    const newsPopups = await sanityFetch<NewsPopupEntry[]>({
      query:  HELP_NEWS_POPUP_QUERY,
      params: { locale, since },
      tags:   ["newsEntry"],
    })
    return NextResponse.json(newsPopups)
  } catch (error) {
    reportError(error, { area: "api", action: "help.news-popups-fetch" })
    return NextResponse.json({ error: "Centre d'aide indisponible, réessayez plus tard." }, { status: 502 })
  }
}, { allowWhenLocked: true })
