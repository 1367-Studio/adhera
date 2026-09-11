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

  // French is the source catalogue (scripts/generate-locale.ts derives the others from it), so
  // a key that a locale has not been generated for yet renders in French rather than as a raw
  // key path — new features ship fr + en first and the remaining catalogues catch up.
  const frenchMessages = (await import("../messages/fr.json")).default as Messages
  const messages = locale === DEFAULT_LOCALE
    ? frenchMessages
    : await mergedMessagesFor(locale, frenchMessages)

  return { locale, messages }
})

type Messages = Record<string, unknown>

// Both catalogues are static JSON, so the merge is computed once per locale per process —
// not on every request. The warning is the one signal that a catalogue lags the French
// source: the key count is what scripts/generate-locale.ts <locale> will translate.
const mergedMessagesByLocale = new Map<Locale, Messages>()

async function mergedMessagesFor(locale: Locale, frenchMessages: Messages): Promise<Messages> {
  const cached = mergedMessagesByLocale.get(locale)
  if (cached) return cached

  const localeMessages = (await import(`../messages/${locale}.json`)).default as Messages
  const missingKeyCount = countMissingKeys(frenchMessages, localeMessages)
  if (missingKeyCount > 0) {
    console.warn(`[i18n] ${locale}: ${missingKeyCount} keys fall back to French — run \`npx tsx scripts/generate-locale.ts ${locale}\` to translate them.`)
  }

  const merged = mergeMessages(frenchMessages, localeMessages)
  mergedMessagesByLocale.set(locale, merged)
  return merged
}

function countMissingKeys(base: Messages, override: Messages): number {
  let missing = 0
  for (const [key, baseValue] of Object.entries(base)) {
    const overrideValue = override[key]
    if (overrideValue === undefined) missing += isMessageTree(baseValue) ? countLeaves(baseValue) : 1
    else if (isMessageTree(baseValue) && isMessageTree(overrideValue)) missing += countMissingKeys(baseValue, overrideValue)
  }
  return missing
}

function countLeaves(tree: Messages): number {
  return Object.values(tree).reduce<number>((count, value) => count + (isMessageTree(value) ? countLeaves(value) : 1), 0)
}

function isMessageTree(value: unknown): value is Messages {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function mergeMessages(base: Messages, override: Messages): Messages {
  const merged: Messages = { ...base }
  for (const [key, overrideValue] of Object.entries(override)) {
    const baseValue = merged[key]
    merged[key] = isMessageTree(baseValue) && isMessageTree(overrideValue)
      ? mergeMessages(baseValue, overrideValue)
      : overrideValue
  }
  return merged
}
