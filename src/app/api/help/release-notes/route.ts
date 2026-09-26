import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { resolveHelpLocale } from "@/lib/help/locale"
import { sanityFetch } from "@/sanity/fetch"
import { HELP_RELEASE_NOTES_QUERY } from "@/sanity/queries"
import type { ReleaseNote } from "@/sanity/types"
import { reportError } from "@/lib/monitoring"

// Older entries never pop up, even if a user has not seen them yet.
const RELEASE_NOTES_MAX_AGE_DAYS = 90

export const GET = withAdminAuth(async () => {
  const locale = await resolveHelpLocale()

  const sinceDate = new Date()
  sinceDate.setUTCDate(sinceDate.getUTCDate() - RELEASE_NOTES_MAX_AGE_DAYS)
  const since = sinceDate.toISOString().slice(0, 10)

  try {
    const releaseNotes = await sanityFetch<ReleaseNote[]>({
      query:  HELP_RELEASE_NOTES_QUERY,
      params: { locale, since },
      tags:   ["changelogEntry"],
    })
    return NextResponse.json(releaseNotes)
  } catch (error) {
    reportError(error, { area: "api", action: "help.release-notes-fetch" })
    return NextResponse.json({ error: "Centre d'aide indisponible, réessayez plus tard." }, { status: 502 })
  }
}, { allowWhenLocked: true })
