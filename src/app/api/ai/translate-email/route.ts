import { NextResponse } from "next/server"
import { z } from "zod"
import { withAdminAuth } from "@/lib/api-wrapper"
import { rateLimit } from "@/lib/rate-limit"
import { translateEmailContent } from "@/lib/i18n/translate"
import { SUPPORTED_LOCALES } from "@/i18n/locales"

// Preview/translate an admin-composed email (SendEmailModal, TemplateModal) into one or more
// target locales before sending — distinct from translateFields' public-page usage, which
// translates content that's already decided to be shown, with no review step.
const schema = z.object({
  subject:  z.string().min(1).max(200),
  bodyHtml: z.string().min(1).max(50_000),
  // Batched so the "one version per recipient's preferred language" review step can fetch
  // every distinct locale in a single request instead of one round trip each.
  locales:  z.array(z.enum(SUPPORTED_LOCALES)).min(1).max(SUPPORTED_LOCALES.length),
})

export const POST = withAdminAuth(async (req, ctx) => {
  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 400 })

  const { subject, bodyHtml, locales } = parsed.data

  if (!(await rateLimit(`translate-email:${ctx.associationId}`, 20, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de requêtes, réessayez plus tard." }, { status: 429 })
  }

  const uniqueLocales = [...new Set(locales)]
  const entries = await Promise.all(
    uniqueLocales.map(async (locale) => {
      const result = await translateEmailContent(subject, bodyHtml, locale, ctx.associationId)
      return [locale, result] as const
    })
  )

  return NextResponse.json({ results: Object.fromEntries(entries) })
}, { module: "messages" })
