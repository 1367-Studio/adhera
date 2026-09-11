import { NextResponse } from "next/server"
import { z } from "zod"
import { withAdminAuth } from "@/lib/api-wrapper"
import { resolveHelpLocale } from "@/lib/help/locale"
import { HELP_MODULE_KEYS } from "@/lib/help/modules"
import { sanityFetch } from "@/sanity/fetch"
import { HELP_MODULE_CONTENT_QUERY } from "@/sanity/queries"
import type { HelpModuleContent } from "@/sanity/types"

const querySchema = z.object({
  module: z.enum(HELP_MODULE_KEYS).default("general"),
})

// Help content is the same for every association and every role: any dashboard session may
// read it, including one whose subscription is locked — the help panel is where such a user
// looks for what to do next.
export const GET = withAdminAuth(async (req) => {
  const { searchParams } = new URL(req.url)
  const parsed = querySchema.safeParse({ module: searchParams.get("module") ?? undefined })
  if (!parsed.success) return NextResponse.json({ error: "Module inconnu" }, { status: 400 })

  const locale = await resolveHelpLocale()

  try {
    const content = await sanityFetch<HelpModuleContent>({
      query:  HELP_MODULE_CONTENT_QUERY,
      params: { module: parsed.data.module, locale },
      tags:   ["helpArticle", "faqEntry"],
    })
    return NextResponse.json(content)
  } catch (error) {
    console.error("[help] articles fetch failed:", error)
    return NextResponse.json({ error: "Centre d'aide indisponible, réessayez plus tard." }, { status: 502 })
  }
}, { allowWhenLocked: true })
