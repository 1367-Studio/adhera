import { getRequestConfig } from "next-intl/server"
import { cookies, headers } from "next/headers"
import { DEFAULT_LOCALE, NEXT_LOCALE_COOKIE, SUPPORTED_LOCALES, isSupportedLocale, type Locale } from "./locales"

// Walks the header in the browser's own order of preference and takes the first tag the app
// can actually render. Each entry is tried at full length before being narrowed to its base
// language: dropping the region up front (the previous behaviour) meant a browser set to
// pt-PT could only ever match "pt" — European Portuguese was unreachable by detection even
// though the catalogue exists. Quality values (";q=0.8") are stripped but not sorted on:
// browsers already emit the list most-preferred first.
function localeFromAcceptLanguage(header: string | null): Locale | undefined {
  if (!header) return undefined

  for (const part of header.split(",")) {
    const tag = part.split(";")[0].trim()
    if (!tag) continue
    // "pt-pt" from the header vs "pt-PT" in SUPPORTED_LOCALES — BCP-47 tags are
    // case-insensitive, so compare on a normalised form rather than missing the match.
    const exact = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === tag.toLowerCase())
    if (exact) return exact
    const base = tag.split("-")[0].toLowerCase()
    const fallback = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === base)
    if (fallback) return fallback
  }
  return undefined
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies()
  const cookieLocale = cookieStore.get(NEXT_LOCALE_COOKIE)?.value

  let locale: Locale | undefined = isSupportedLocale(cookieLocale) ? cookieLocale : undefined

  if (!locale) {
    const acceptLanguage = (await headers()).get("accept-language")
    locale = localeFromAcceptLanguage(acceptLanguage)
  }

  if (!locale) locale = DEFAULT_LOCALE

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  }
})
