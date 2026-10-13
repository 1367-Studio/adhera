"use server"

import { randomBytes } from "crypto"
import { cookies, headers } from "next/headers"
import { signIn, signOut, resolveCredentialsUser, OAUTH_PORTAL_SLUG_COOKIE } from "@/lib/auth/config"
import { setPendingLogin, setVerifiedLogin } from "@/lib/auth/two-factor-store"
import { AuthError } from "next-auth"
import { BASE_PATH } from "@/lib/env"
import { reportError } from "@/lib/monitoring"
import { rateLimit, ipFromHeaders } from "@/lib/rate-limit"
import { writeActivityLog } from "@/lib/activity-log"
import { alertOnLoginRateLimitBreach } from "@/lib/security-alerts"
import { prisma } from "@/lib/prisma/client"

type LoginState = { error?: string; requires2FA?: true; pendingToken?: string } | undefined

const RATE_LIMIT_ERROR = "Trop de tentatives. Réessayez plus tard."

// No detection existed at all for a wrong password before this (security audit H3, paired
// with H2's rate limit below). A portal attempt already has a known association (resolved
// from the slug), so it's logged where that association's own staff can see it in their
// ActivityLog — same LOGIN_FAILED action already used for a failed 2FA code in
// two-factor.ts. A dashboard attempt has no single tenant to attribute it to: the same
// email can legitimately match zero, one, or several unrelated associations (see
// resolveCredentialsUser's own comment on that), so it's reported to Sentry instead — IP
// and whether a slug was involved only, never the email itself (reportError's own no-PII
// rule).
async function logFailedLogin(email: string, slug: string | null, ip: string) {
  if (slug) {
    const association = await prisma.association.findUnique({ where: { slug }, select: { id: true } })
    if (association) {
      await writeActivityLog({
        associationId: association.id,
        action:        "LOGIN_FAILED",
        entity:        "User",
        label:         email,
        metadata:      { ip },
      })
      return
    }
  }
  reportError(new Error("Failed login attempt"), { area: "api", action: "auth.login-failed", extra: { ip, hasSlug: !!slug } })
}

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

  const ip = ipFromHeaders(await headers())

  // Two independent buckets, checked before ever touching bcrypt: per-email stops a
  // focused brute force on one account even spread across many IPs (a botnet); per-IP
  // stops one source spraying many accounts/passwords, which the per-email bucket alone
  // wouldn't catch. Same budget as the 2FA code-entry rate limit in two-factor.ts
  // (8/15min) — bcrypt.compare() below is already the slow/expensive part of a guess,
  // this just caps how many of those a single account or source gets per window.
  const emailKey     = `login-email:${email.toLowerCase()}`
  const ipKey        = `login-ip:${ip}`
  const EMAIL_LIMIT  = 8
  const IP_LIMIT     = 20
  const WINDOW_MS    = 15 * 60 * 1000
  const emailAllowed = await rateLimit(emailKey, EMAIL_LIMIT, WINDOW_MS)
  const ipAllowed    = await rateLimit(ipKey, IP_LIMIT, WINDOW_MS)
  if (!emailAllowed || !ipAllowed) {
    // Security audit M1 — fire-and-forget, never blocks the (already rate-limited) response.
    if (!emailAllowed) alertOnLoginRateLimitBreach(emailKey, EMAIL_LIMIT, WINDOW_MS, `Compte ciblé : ${email}`)
    if (!ipAllowed)    alertOnLoginRateLimitBreach(ipKey, IP_LIMIT, WINDOW_MS, `Adresse IP : ${ip}`)
    return { error: RATE_LIMIT_ERROR }
  }

  // Resolved up front — once, here — rather than letting signIn() run the same bcrypt
  // check again inside authorize(): a 2FA-enabled account also needs to be intercepted
  // here instead of completing sign-in immediately, and this is the one check that tells
  // us which case we're in (twoFactorEnabled). Completing the sign-in for that case is
  // verifyTwoFactorLogin() (src/lib/auth/two-factor.ts), once the second factor is
  // verified. Staff-only in practice: 2FA can't be enabled on a MEMBRE account (see
  // requireStaffSession() in two-factor.ts), so this never fires for portal logins even
  // though the same code path is shared with PortalLoginForm.
  const user = await resolveCredentialsUser(email, password, slug)
  if (!user) {
    await logFailedLogin(email, slug, ip)
    return { error: "Identifiants incorrects. Veuillez réessayer." }
  }

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
      reportError(error, { area: "api", action: "auth.sign-in", extra: { userId: user.id, authErrorType: error.type } })
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
