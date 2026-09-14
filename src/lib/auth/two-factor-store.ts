import { Redis } from "@upstash/redis"

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

if (!UPSTASH_URL || !UPSTASH_TOKEN) {
  console.error(
    "[two-factor-store] MISCONFIGURED: UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN not set — " +
    "2FA setup and login verification will fail until this is fixed."
  )
}

const redis = new Redis({ url: UPSTASH_URL!, token: UPSTASH_TOKEN! })

// Shares an Upstash account with asr-temp — every key here is namespaced so the two
// projects never collide in that one shared database (see src/lib/rate-limit.ts, same
// convention). A separate client from rate-limit.ts on purpose: unlike rate limiting, a
// failed read here must not fail open (see get* below), so the two shouldn't be coupled.
const KEY_PREFIX = "adhera:2fa:"

const SETUP_TTL_SECONDS    = 10 * 60
const LOGIN_TTL_SECONDS    = 5 * 60
const VERIFIED_TTL_SECONDS = 60

export interface PendingLogin {
  userId: string
  slug: string | null
  callbackUrl: string | null
}

// ── Pending TOTP setup (QR generated, not yet confirmed) ─────────────────────────

export async function setPendingSetup(userId: string, secret: string): Promise<void> {
  await redis.set(`${KEY_PREFIX}setup:${userId}`, secret, { ex: SETUP_TTL_SECONDS })
}

export async function getPendingSetup(userId: string): Promise<string | null> {
  try {
    return await redis.get<string>(`${KEY_PREFIX}setup:${userId}`)
  } catch (err) {
    console.error("[two-factor-store] Redis read failed (pending setup), treating as expired:", err)
    return null
  }
}

export async function clearPendingSetup(userId: string): Promise<void> {
  await redis.del(`${KEY_PREFIX}setup:${userId}`).catch(() => {})
}

// ── Pending login (password validated, waiting on the second factor) ─────────────

export async function setPendingLogin(token: string, data: PendingLogin): Promise<void> {
  await redis.set(`${KEY_PREFIX}pending:${token}`, data, { ex: LOGIN_TTL_SECONDS })
}

export async function getPendingLogin(token: string): Promise<PendingLogin | null> {
  try {
    return await redis.get<PendingLogin>(`${KEY_PREFIX}pending:${token}`)
  } catch (err) {
    console.error("[two-factor-store] Redis read failed (pending login), treating as expired:", err)
    return null
  }
}

export async function clearPendingLogin(token: string): Promise<void> {
  await redis.del(`${KEY_PREFIX}pending:${token}`).catch(() => {})
}

// ── Verified login (credentials + second factor, if any, already checked — the only
// state authorize()'s twoFactorToken branch in auth/config.ts actually trusts) ───────
//
// Kept as a distinct key namespace from "pending" above rather than reusing the same
// token: a "pending" record only proves the password was checked, so it must never be
// accepted by authorize() on its own for a 2FA-enabled account — only verifyTwoFactorLogin
// (src/lib/auth/two-factor.ts), after checking the actual code, is allowed to mint a
// "verified" record. Mixing the two into one namespace would mean the pendingToken handed
// back to the browser while still awaiting a code (in the requires2FA response) could be
// replayed directly against signIn() to skip the second factor entirely.

export async function setVerifiedLogin(token: string, data: PendingLogin): Promise<void> {
  await redis.set(`${KEY_PREFIX}verified:${token}`, data, { ex: VERIFIED_TTL_SECONDS })
}

export async function getVerifiedLogin(token: string): Promise<PendingLogin | null> {
  try {
    return await redis.get<PendingLogin>(`${KEY_PREFIX}verified:${token}`)
  } catch (err) {
    console.error("[two-factor-store] Redis read failed (verified login), treating as expired:", err)
    return null
  }
}

export async function clearVerifiedLogin(token: string): Promise<void> {
  await redis.del(`${KEY_PREFIX}verified:${token}`).catch(() => {})
}
