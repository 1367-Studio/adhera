import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { resolveHelpLocale } from "@/lib/help/locale"
import { sanityFetch } from "@/sanity/fetch"
import { HELP_CONTENT_QUERY } from "@/sanity/queries"
import type { HelpContent } from "@/sanity/types"
import { reportError } from "@/lib/monitoring"

// Help content is the same for every association and every role: any dashboard session may
// read it, including one whose subscription is locked — the help panel is where such a user
// looks for what to do next.
export const GET = withAdminAuth(async () => {
  const locale = await resolveHelpLocale()

  try {
    const content = await sanityFetch<HelpContent>({
      query:  HELP_CONTENT_QUERY,
      params: { locale },
      tags:   ["helpArticle", "faqEntry"],
    })
    return NextResponse.json(content)
  } catch (error) {
    reportError(error, { area: "api", action: "help.articles-fetch" })
    return NextResponse.json({ error: "Centre d'aide indisponible, réessayez plus tard." }, { status: 502 })
  }
}, { allowWhenLocked: true })
