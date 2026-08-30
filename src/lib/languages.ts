import { SUPPORTED_LOCALES, LOCALE_LABELS, isSupportedLocale, type Locale } from "@/i18n/locales"

// Langues proposées pour Membre.spokenLanguage : les mêmes que les langues disponibles dans
// l'application (SUPPORTED_LOCALES), avec les mêmes libellés. Colonne distincte de
// preferredLocale (langue de l'interface/des e-mails) : ici c'est la langue que la personne
// parle, saisie par l'admin, par le membre sur le portail ou via un MembershipForm.
export const SPOKEN_LANGUAGE_CODES = SUPPORTED_LOCALES

export type SpokenLanguage = Locale

export function isSpokenLanguage(value: string | null | undefined): value is SpokenLanguage {
  return isSupportedLocale(value)
}

export function spokenLanguageLabel(code: string): string {
  return isSupportedLocale(code) ? LOCALE_LABELS[code] : code
}

export function spokenLanguageOptions(): { value: SpokenLanguage; label: string }[] {
  return SUPPORTED_LOCALES.map(value => ({ value, label: LOCALE_LABELS[value] }))
}
