"use server"

import { cookies } from "next/headers"
import { signIn, signOut, OAUTH_PORTAL_SLUG_COOKIE } from "@/lib/auth/config"
import { AuthError } from "next-auth"

type LoginState = { error?: string } | undefined

export async function authenticate(prevState: LoginState, formData: FormData): Promise<LoginState> {
  const email       = formData.get("email")       as string
  const password    = formData.get("password")    as string
  const slug        = (formData.get("slug")        as string | null)?.trim() || null
  const callbackUrl = (formData.get("callbackUrl") as string | null)?.trim() || null

  const defaultRedirect = slug ? `/portal/${slug}/actualites` : "/dashboard"

  try {
    await signIn("credentials", { email, password, ...(slug ? { slug } : {}), redirectTo: callbackUrl ?? defaultRedirect })
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "Identifiants incorrects. Veuillez réessayer." }
    }
    throw error
  }
}

export async function logout(redirectTo = "/login") {
  await signOut({ redirectTo })
}

export async function signInWithGoogleDashboard() {
  await signIn("google", { redirectTo: "/dashboard" })
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
  await signIn("google", { redirectTo: callbackUrl ?? `/portal/${slug}/actualites` })
}
