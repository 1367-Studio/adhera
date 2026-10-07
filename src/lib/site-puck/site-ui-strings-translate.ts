import { translateFields } from "@/lib/i18n/translate"
import { DEFAULT_LOCALE, type Locale } from "@/i18n/locales"
import { SITE_UI_STRINGS, type SiteUiStringKey, type SiteUiStrings } from "@/lib/site-puck/site-ui-strings"

// Server-only: translateFields pulls in Prisma/the Postgres driver, so this stays out of
// site-ui-strings.ts, which "use client" components import for the plain SITE_UI_STRINGS data.
// Translated once per locale in one call (same BYOK-then-Azure pipeline, src/lib/i18n/translate.ts)
// — these strings never change, so after the first visitor in a given locale this is a cache hit.

const UI_STRING_KEYS = Object.keys(SITE_UI_STRINGS) as SiteUiStringKey[]

export async function translateSiteUiStrings(locale: Locale, associationId: string): Promise<SiteUiStrings> {
  if (locale === DEFAULT_LOCALE) return SITE_UI_STRINGS
  const [translated] = await translateFields([SITE_UI_STRINGS], UI_STRING_KEYS, locale, associationId)
  return translated
}
