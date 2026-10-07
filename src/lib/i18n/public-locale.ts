import { cookies, headers } from "next/headers"
import { localeFromAcceptLanguage } from "@/i18n/request"
import { DEFAULT_LOCALE, NEXT_LOCALE_COOKIE, SITE_LOCALE_COOKIE, isSupportedLocale, type Locale } from "@/i18n/locales"

// The language an anonymous visitor sees a public association site in — the site builder's
// "Traduction" block (src/components/site/blocks/site-block-translate.tsx) and every public
// checkout page (event registration, adhesion, dons) resolve locale through this one function,
// so a visitor's choice carries consistently across all of them.
//
// Order: SITE_LOCALE cookie (this visitor's own choice, made on any public page) → NEXT_LOCALE
// cookie (read-only here — a signal from an unrelated portal/dashboard session in the same
// browser, e.g. a logged-in member's own saved language, useful as a first-visit default) →
// Accept-Language → French. SITE_LOCALE is the only one these pages ever WRITE: writing
// NEXT_LOCALE from a public page is what used to bleed a visitor's translation choice into
// their portal/dashboard language if they happened to be logged in — see the comment on
// SITE_LOCALE_COOKIE. Reading NEXT_LOCALE here is harmless, since it only affects the page
// that read it, never reaches back into the portal.
export async function resolvePublicLocale(): Promise<Locale> {
  const cookieStore = await cookies()

  const siteLocale = cookieStore.get(SITE_LOCALE_COOKIE)?.value
  if (isSupportedLocale(siteLocale)) return siteLocale

  const nextLocale = cookieStore.get(NEXT_LOCALE_COOKIE)?.value
  if (isSupportedLocale(nextLocale)) return nextLocale

  const acceptLanguage = (await headers()).get("accept-language")
  return localeFromAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE
}
