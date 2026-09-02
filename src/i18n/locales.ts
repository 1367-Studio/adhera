// The 24 official languages of the European Union, plus the Brazilian Portuguese variant the
// app already carried. Tags are BCP-47 — the same strings the browser sends in
// accept-language and that Azure Translator accepts as a target (see lib/i18n/translate.ts).
//
// This list is the TARGET set: it says which languages the product intends to serve, and it
// drives scripts/generate-locale.ts. It is NOT what the app can render — that is
// SUPPORTED_LOCALES below, which may only ever contain locales that actually have a
// src/messages/<tag>.json catalogue, since i18n/request.ts imports that file by name and a
// missing one is a runtime crash.
export const EU_LOCALES = [
  "bg", "cs", "da", "de", "el", "en", "es", "et", "fi", "fr", "ga", "hr", "hu",
  "it", "lt", "lv", "mt", "nl", "pl", "pt", "pt-PT", "ro", "sk", "sl", "sv",
] as const
export type EuLocale = (typeof EU_LOCALES)[number]

// Locales the app can actually render today — one entry per catalogue in src/messages.
// To enable a new one: run `npx tsx scripts/generate-locale.ts <tag>`, review the output,
// then add the tag here. Nothing else needs changing; detection, the switcher, the "langue
// parlée" list and content translation all read from this array.
export const SUPPORTED_LOCALES = ["fr", "en", "pt", "pt-PT", "es"] as const satisfies readonly EuLocale[]
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: Locale = "fr"

// Endonyms on purpose — someone hunting for their own language scans for "Ελληνικά", never
// for "Greek". Covers every EU_LOCALE so a tag can be enabled without touching this map.
export const LOCALE_LABELS: Record<EuLocale, string> = {
  bg:      "Български",
  cs:      "Čeština",
  da:      "Dansk",
  de:      "Deutsch",
  el:      "Ελληνικά",
  en:      "English",
  es:      "Español",
  et:      "Eesti",
  fi:      "Suomi",
  fr:      "Français",
  ga:      "Gaeilge",
  hr:      "Hrvatski",
  hu:      "Magyar",
  it:      "Italiano",
  lt:      "Lietuvių",
  lv:      "Latviešu",
  mt:      "Malti",
  nl:      "Nederlands",
  pl:      "Polski",
  pt:      "Português (Brasil)",
  "pt-PT": "Português (Portugal)",
  ro:      "Română",
  sk:      "Slovenčina",
  sl:      "Slovenščina",
  sv:      "Svenska",
}

export function isSupportedLocale(value: string | undefined | null): value is Locale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

export const NEXT_LOCALE_COOKIE = "NEXT_LOCALE"
