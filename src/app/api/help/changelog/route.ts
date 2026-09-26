import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { resolveHelpLocale } from "@/lib/help/locale"
import { sanityFetch } from "@/sanity/fetch"
import { HELP_CHANGELOG_QUERY } from "@/sanity/queries"
import type { ChangelogEntry } from "@/sanity/types"
import { reportError } from "@/lib/monitoring"

export const GET = withAdminAuth(async () => {
  const locale = await resolveHelpLocale()

  try {
    const entries = await sanityFetch<ChangelogEntry[]>({
      query:  HELP_CHANGELOG_QUERY,
      params: { locale },
      tags:   ["changelogEntry"],
    })
    return NextResponse.json(entries)
  } catch (error) {
    reportError(error, { area: "api", action: "help.changelog-fetch" })
    return NextResponse.json({ error: "Centre d'aide indisponible, réessayez plus tard." }, { status: 502 })
  }
}, { allowWhenLocked: true })
