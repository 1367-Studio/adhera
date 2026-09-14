import { NextResponse } from "next/server"
import { z } from "zod"
import { withAdminAuth } from "@/lib/api-wrapper"
import { resolveHelpLocale } from "@/lib/help/locale"
import { sanityFetch } from "@/sanity/fetch"
import { HELP_ARTICLE_BY_SLUG_QUERY } from "@/sanity/queries"
import type { HelpArticle } from "@/sanity/types"

// Slugs are generated lowercase-hyphen by the Studio; anything else can only be a bad link.
const slugSchema = z.string().trim().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)

export const GET = withAdminAuth<{ slug: string }>(async (_req, _ctx, { slug }) => {
  const parsedSlug = slugSchema.safeParse(slug)
  if (!parsedSlug.success) return NextResponse.json({ error: "Article introuvable", code: "NOT_FOUND" }, { status: 404 })

  const locale = await resolveHelpLocale()

  try {
    const article = await sanityFetch<HelpArticle | null>({
      query:  HELP_ARTICLE_BY_SLUG_QUERY,
      params: { slug: parsedSlug.data, locale },
      tags:   ["helpArticle", `helpArticle:${parsedSlug.data}`],
    })
    if (!article) return NextResponse.json({ error: "Article introuvable", code: "NOT_FOUND" }, { status: 404 })
    return NextResponse.json(article)
  } catch (error) {
    console.error("[help] article fetch failed:", error)
    return NextResponse.json({ error: "Centre d'aide indisponible, réessayez plus tard." }, { status: 502 })
  }
}, { allowWhenLocked: true })
