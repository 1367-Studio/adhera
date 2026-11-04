import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { resolveHelpLocale } from "@/lib/help/locale"
import { sanityFetch } from "@/sanity/fetch"
import { HELP_FAQ_POPUP_QUERY } from "@/sanity/queries"
import type { FaqPopupEntry } from "@/sanity/types"
import { reportError } from "@/lib/monitoring"

// Older entries never pop up, even if a user has not seen them yet — same window as the
// changelog/news pop-ups, applied here against _createdAt (see the query comment).
const FAQ_POPUP_MAX_AGE_DAYS = 90

export const GET = withAdminAuth(async () => {
  const locale = await resolveHelpLocale()

  const sinceDate = new Date()
  sinceDate.setUTCDate(sinceDate.getUTCDate() - FAQ_POPUP_MAX_AGE_DAYS)
  const since = sinceDate.toISOString()

  try {
    const faqPopups = await sanityFetch<FaqPopupEntry[]>({
      query:  HELP_FAQ_POPUP_QUERY,
      params: { locale, since },
      tags:   ["faqEntry"],
    })
    return NextResponse.json(faqPopups)
  } catch (error) {
    reportError(error, { area: "api", action: "help.faq-popups-fetch" })
    return NextResponse.json({ error: "Centre d'aide indisponible, réessayez plus tard." }, { status: 502 })
  }
}, { allowWhenLocked: true })
