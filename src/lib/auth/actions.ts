"use server"

import { cookies } from "next/headers"
import { signIn, signOut, OAUTH_PORTAL_SLUG_COOKIE } from "@/lib/auth/config"
import { AuthError } from "next-auth"
import { BASE_PATH } from "@/lib/env"

type LoginState = { error?: string } | undefined

// Auth.js's default `redirect` callback resolves a relative `redirectTo` against the
// request's bare origin (`url.origin`, see @auth/core/lib/init.js) — it has no notion of
// Next's `basePath`, so every redirectTo/callbackUrl passed to signIn()/signOut() must be
// prefixed here explicitly, same as every other absolute in-app navigation in this codebase
// (see BASE_PATH's own doc comment in src/lib/env.ts).
export async function authenticate(prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email       = formData.get("email")       as string
  const password    = formData.get("password")    as string
  const slug        = (formData.get("slug")        as string | null)?.trim() || null
  const callbackUrl = (formData.get("callbackUrl") as string | null)?.trim() || null

  const defaultRedirect = slug ? `/portal/${slug}/actualites` : "/dashboard"

  try {
    await signIn("credentials", { email, password, ...(slug ? { slug } : {}), redirectTo: `${BASE_PATH}${callbackUrl ?? defaultRedirect}` })
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Identifiants incorrects. Veuillez réessayer." }
    }
    throw error
  }
}

export async function logout(redirectTo = `${BASE_PATH}/login`) {
  await signOut({ redirectTo })
}

export async function signInWithGoogleDashboard() {
  // Clear a stale portal-slug cookie from an abandoned portal Google sign-in (see
  // signInWithGooglePortal below) — otherwise the signIn callback in auth/config.ts would
  // still find it and treat this dashboard sign-in as a portal one for that association.
  const cookieStore = await cookies()
  cookieStore.delete(OAUTH_PORTAL_SLUG_COOKIE)
  await signIn("google", { redirectTo: `${BASE_PATH}/dashboard` })
}

export async function signInWithGooglePortal(slug: string, callbackUrl?: string) {
  const cookieStore = await cookies()
  // Read back by the signIn callback in auth/config.ts to know which association this
  // Google sign-in is scoped to — short-lived since it only needs to survive the redirect
  // to Google's consent screen and back.
  cookieStore.set(OAUTH_PORTAL_SLUG_COOKIE, slug, {
    httpOnly: true,
    secure:   process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge:   600,
    path:     "/",
  })
  await signIn("google", { redirectTo: `${BASE_PATH}${callbackUrl ?? `/portal/${slug}/actualites`}` })
}
