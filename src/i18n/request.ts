import { getRequestConfig } from "next-intl/server"
import { cookies, headers } from "next/headers"
import { DEFAULT_LOCALE, NEXT_LOCALE_COOKIE, isSupportedLocale, type Locale } from "./locales"

function localeFromAcceptLanguage(header: string | null): Locale | undefined {
  return header
    ?.split(",")
    .map((part) => part.split(";")[0].trim().split("-")[0])
    .find((lang): lang is Locale => isSupportedLocale(lang))
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
