export const SUPPORTED_LOCALES = ["fr", "en", "pt", "pt-PT", "es"] as const
export type Locale = (typeof SUPPORTED_LOCALES)[number]
export const DEFAULT_LOCALE: Locale = "fr"

// Single source of truth for display names — shared between LocaleSwitcher and any admin/
// portal UI offering a "langue préférée" select (e.g. Membre.preferredLocale).
export const LOCALE_LABELS: Record<Locale, string> = {
  fr: "Français",
  en: "English",
  pt: "Português (Brasil)",
  "pt-PT": "Português (Portugal)",
  es: "Español",
}

export function isSupportedLocale(value: string | undefined | null): value is Locale {
  return !!value && (SUPPORTED_LOCALES as readonly string[]).includes(value)
}

export const NEXT_LOCALE_COOKIE = "NEXT_LOCALE"
