import { NextResponse } from "next/server"
import { z } from "zod"
import { withAdminAuth } from "@/lib/api-wrapper"
import { resolveHelpLocale } from "@/lib/help/locale"
import { searchHelp } from "@/lib/help/retrieval"
import { rateLimit } from "@/lib/rate-limit"

const querySchema = z.object({
  q: z.string().trim().min(3).max(200),
})

export const GET = withAdminAuth(async (req, ctx) => {
  const { searchParams } = new URL(req.url)
  const parsed = querySchema.safeParse({ q: searchParams.get("q") ?? "" })
  if (!parsed.success) return NextResponse.json({ error: "Recherche invalide (3 à 200 caractères)" }, { status: 400 })

  // Every search is a live (uncached) Sanity query, hence the per-user throttle.
  if (!(await rateLimit(`help-search:${ctx.userId}`, 30, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de requêtes, réessayez plus tard." }, { status: 429 })
  }

  const locale = await resolveHelpLocale()

  try {
    const hits = await searchHelp({ query: parsed.data.q, locale, limit: 10 })
    return NextResponse.json(hits)
  } catch (error) {
    console.error("[help] search failed:", error)
    return NextResponse.json({ error: "Recherche indisponible, réessayez plus tard." }, { status: 502 })
  }
}, { allowWhenLocked: true })
