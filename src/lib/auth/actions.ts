"use server"

import { randomBytes } from "crypto"
import { cookies } from "next/headers"
import { signIn, signOut, resolveCredentialsUser, OAUTH_PORTAL_SLUG_COOKIE } from "@/lib/auth/config"
import { setPendingLogin, setVerifiedLogin } from "@/lib/auth/two-factor-store"
import { AuthError } from "next-auth"
import { BASE_PATH } from "@/lib/env"

type LoginState = { error?: string; requires2FA?: true; pendingToken?: string } | undefined

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

  const defaultRedirect = slug ? `/portal/${slug}` : "/dashboard"

  // Resolved up front — once, here — rather than letting signIn() run the same bcrypt
  // check again inside authorize(): a 2FA-enabled account also needs to be intercepted
  // here instead of completing sign-in immediately, and this is the one check that tells
  // us which case we're in (twoFactorEnabled). Completing the sign-in for that case is
  // verifyTwoFactorLogin() (src/lib/auth/two-factor.ts), once the second factor is
  // verified. Staff-only in practice: 2FA can't be enabled on a MEMBRE account (see
  // requireStaffSession() in two-factor.ts), so this never fires for portal logins even
  // though the same code path is shared with PortalLoginForm.
  const user = await resolveCredentialsUser(email, password, slug)
  if (!user) return { error: "Identifiants incorrects. Veuillez réessayer." }

  if (user.twoFactorEnabled) {
    const pendingToken = randomBytes(32).toString("hex")
    await setPendingLogin(pendingToken, { userId: user.id, slug, callbackUrl })
    return { requires2FA: true, pendingToken }
  }

  // No second factor to check — mint a single-use "verified" token instead of calling
  // signIn() with the raw password again, which would make authorize() run the exact same
  // bcrypt.compare() a second time for every login (bcrypt is deliberately slow; this
  // roughly doubled sign-in latency before). See getVerifiedLogin's doc comment in
  // two-factor-store.ts for why this needs its own namespace instead of just handing back
  // a token the browser would receive in the requires2FA branch above.
  const verifiedToken = randomBytes(32).toString("hex")
  await setVerifiedLogin(verifiedToken, { userId: user.id, slug, callbackUrl })

  try {
    await signIn("credentials", { twoFactorToken: verifiedToken, redirectTo: `${BASE_PATH}${callbackUrl ?? defaultRedirect}` })
  } catch (error) {
    if (error instanceof AuthError) {
      // AuthError covers more than "wrong password" (e.g. authorize() throwing on a DB
      // error, or NextAuth's own config/callback failures) — all surfaced identically to
      // the user by design, but logging the real cause/type here means a report like
      // "I didn't change my password" is diagnosable from server logs instead of a guess.
      console.error("[auth] signIn failed:", error.type, error.cause ?? error)
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
  await signIn("google", { redirectTo: `${BASE_PATH}${callbackUrl ?? `/portal/${slug}`}` })
}
