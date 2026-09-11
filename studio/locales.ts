// Mirror of the app's SUPPORTED_LOCALES + LOCALE_LABELS (src/i18n/locales.ts).
// The app is the source of truth: when a locale is enabled there, add it here too.
export type StudioLanguage = { id: string; title: string }

export const DEFAULT_LANGUAGE_ID = "fr"

export const STUDIO_LANGUAGES: StudioLanguage[] = [
  { id: "fr", title: "Français" },
  { id: "en", title: "English" },
  { id: "pt", title: "Português (Brasil)" },
  { id: "pt-PT", title: "Português (Portugal)" },
  { id: "es", title: "Español" },
  { id: "bg", title: "Български" },
  { id: "cs", title: "Čeština" },
  { id: "da", title: "Dansk" },
  { id: "de", title: "Deutsch" },
  { id: "el", title: "Ελληνικά" },
  { id: "et", title: "Eesti" },
  { id: "fi", title: "Suomi" },
  { id: "ga", title: "Gaeilge" },
  { id: "hr", title: "Hrvatski" },
  { id: "hu", title: "Magyar" },
  { id: "it", title: "Italiano" },
  { id: "lt", title: "Lietuvių" },
  { id: "lv", title: "Latviešu" },
  { id: "mt", title: "Malti" },
  { id: "nl", title: "Nederlands" },
  { id: "pl", title: "Polski" },
  { id: "ro", title: "Română" },
  { id: "sk", title: "Slovenčina" },
  { id: "sl", title: "Slovenščina" },
  { id: "sv", title: "Svenska" },
]
