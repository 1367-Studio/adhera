import { getLocale } from "next-intl/server"
import { DEFAULT_LOCALE, isSupportedLocale, type Locale } from "@/i18n/locales"

// Server-only (next-intl/server) — route handlers use this to pick which translation of the
// help content to serve; the client never sends a locale itself.

// getLocale() resolves the same way pages do (NEXT_LOCALE cookie, then accept-language —
// src/i18n/request.ts); narrowed to Locale so an unexpected value can never reach GROQ.
export async function resolveHelpLocale(): Promise<Locale> {
  const locale = await getLocale()
  return isSupportedLocale(locale) ? locale : DEFAULT_LOCALE
}
