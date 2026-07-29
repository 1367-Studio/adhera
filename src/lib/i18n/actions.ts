"use server"

import { cookies } from "next/headers"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import { NEXT_LOCALE_COOKIE, isSupportedLocale, type Locale } from "@/i18n/locales"

const ONE_YEAR = 60 * 60 * 24 * 365

type SessionUser = { id?: string }

export async function setLocale(locale: string) {
  if (!isSupportedLocale(locale)) return

  const session = await auth()
  const userId = (session?.user as SessionUser | undefined)?.id
  if (userId) {
    await prisma.user.update({ where: { id: userId }, data: { locale } })
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
