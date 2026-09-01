"use server"

import { cookies } from "next/headers"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import { NEXT_LOCALE_COOKIE, isSupportedLocale, type Locale } from "@/i18n/locales"

const ONE_YEAR = 60 * 60 * 24 * 365

type SessionUser = { id?: string }

// `persistAccountLocale` defaults to true (the normal "change my own language" case). Pass
// false from a context where switching the page's language isn't the visitor expressing a
// personal preference — e.g. a manager previewing a public form in another locale to check
// its wording, who would otherwise find their whole admin dashboard silently switched too.
export async function setLocale(locale: string, persistAccountLocale = true) {
  if (!isSupportedLocale(locale)) return

  if (persistAccountLocale) {
    const session = await auth()
    const userId = (session?.user as SessionUser | undefined)?.id
    if (userId) {
      await prisma.user.update({ where: { id: userId }, data: { locale } })
    }
  }

  await setLocaleCookie(locale)
}

export async function setLocaleCookie(locale: Locale) {
  const cookieStore = await cookies()
  cookieStore.set(NEXT_LOCALE_COOKIE, locale, {
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   ONE_YEAR,
    path:     "/",
  })
}
