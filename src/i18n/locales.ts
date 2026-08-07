export const SUPPORTED_LOCALES = ["fr", "en", "pt", "es"] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: Locale = "fr"

export function isSupportedLocale(value: string | undefined | null): value is Locale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

export const NEXT_LOCALE_COOKIE = "NEXT_LOCALE"
