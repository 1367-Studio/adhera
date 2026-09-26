import { Redis } from "@upstash/redis"
import { reportError } from "@/lib/monitoring"

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

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

// ── Backing store ────────────────────────────────────────────────────────────────
//
// Every function below goes through this one tiny interface (set with a TTL / get /
// delete) so that nothing else in the app — and nothing further down this file — has to
// know which backend is live. Chosen once at module load, never per call.

interface TwoFactorStateStore {
  set(key: string, value: string | PendingLogin, ttlSeconds: number): Promise<void>
  get<TValue>(key: string): Promise<TValue | null>
  delete(key: string): Promise<void>
}

function createRedisStateStore(): TwoFactorStateStore {
  const redis = new Redis({ url: UPSTASH_URL!, token: UPSTASH_TOKEN! })
  return {
    async set(key, value, ttlSeconds) { await redis.set(key, value, { ex: ttlSeconds }) },
    async get<TValue>(key: string): Promise<TValue | null> { return redis.get<TValue>(key) },
    async delete(key) { await redis.del(key) },
  }
}

// Development-only stand-in (see the selection below): a plain Map in this process.
// Entries carry their own expiry and are dropped lazily on read rather than by a timer —
// a setTimeout per token would keep a handle alive for the whole TTL and, on a token that
// is normally consumed within seconds, fire long after anyone cares. Values are stored by
// reference, which is safe because every record written here (a TOTP secret string, a
// freshly built PendingLogin) is treated as read-only by its callers.
function createInMemoryStateStore(): TwoFactorStateStore {
  const entriesByKey = new Map<string, { value: unknown; expiresAtMs: number }>()
  return {
    async set(key, value, ttlSeconds) {
      entriesByKey.set(key, { value, expiresAtMs: Date.now() + ttlSeconds * 1000 })
    },
    async get<TValue>(key: string): Promise<TValue | null> {
      const entry = entriesByKey.get(key)
      if (!entry) return null
      if (entry.expiresAtMs <= Date.now()) {
        entriesByKey.delete(key)
        return null
      }
      return entry.value as TValue
    },
    async delete(key) { entriesByKey.delete(key) },
  }
}

// The writes below deliberately have no try/catch: a login token that failed to store must
// never let the login through. That is the right behaviour for a misconfigured *production*
// deploy, but it also means an unconfigured Upstash makes every single login 500 — which
// would otherwise leave local development with no way to sign in at all. So outside
// production only, missing credentials fall back to the in-memory store above. Production
// keeps exactly the old behaviour: the Redis client, no fallback, and the loud log below.
const isUpstashConfigured   = !!UPSTASH_URL && !!UPSTASH_TOKEN
const useInMemoryStateStore = !isUpstashConfigured && process.env.NODE_ENV !== "production"

if (useInMemoryStateStore) {
  console.warn(
    "[two-factor-store] Upstash not configured — login and 2FA state is kept IN MEMORY in this process only. " +
    "It is lost on every restart (pending logins and TOTP setups simply disappear, as if expired). " +
    "Set UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN to mirror production; this fallback never applies there."
  )
} else if (!isUpstashConfigured) {
  console.error(
    "[two-factor-store] MISCONFIGURED: UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN not set — " +
    "2FA setup and login verification will fail until this is fixed."
  )
}

const stateStore: TwoFactorStateStore = useInMemoryStateStore
  ? createInMemoryStateStore()
  : createRedisStateStore()

// ── Pending TOTP setup (QR generated, not yet confirmed) ─────────────────────────

export async function setPendingSetup(userId: string, secret: string): Promise<void> {
  await stateStore.set(`${KEY_PREFIX}setup:${userId}`, secret, SETUP_TTL_SECONDS)
}

export async function getPendingSetup(userId: string): Promise<string | null> {
  try {
    return await stateStore.get<string>(`${KEY_PREFIX}setup:${userId}`)
  } catch (error) {
    reportError(error, { area: "api", action: "two-factor-store.read-pending-setup", extra: { userId } })
    return null
  }
}

export async function clearPendingSetup(userId: string): Promise<void> {
  await stateStore.delete(`${KEY_PREFIX}setup:${userId}`).catch((error: unknown) => reportError(error, { area: "api", action: "two-factor-store.clear-pending-setup", extra: { userId } }))
}

// ── Pending login (password validated, waiting on the second factor) ─────────────

export async function setPendingLogin(token: string, data: PendingLogin): Promise<void> {
  await stateStore.set(`${KEY_PREFIX}pending:${token}`, data, LOGIN_TTL_SECONDS)
}

export async function getPendingLogin(token: string): Promise<PendingLogin | null> {
  try {
    return await stateStore.get<PendingLogin>(`${KEY_PREFIX}pending:${token}`)
  } catch (error) {
    reportError(error, { area: "api", action: "two-factor-store.read-pending-login" })
    return null
  }
}

export async function clearPendingLogin(token: string): Promise<void> {
  await stateStore.delete(`${KEY_PREFIX}pending:${token}`).catch((error: unknown) => reportError(error, { area: "api", action: "two-factor-store.clear-pending-login" }))
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
  await stateStore.set(`${KEY_PREFIX}verified:${token}`, data, VERIFIED_TTL_SECONDS)
}

export async function getVerifiedLogin(token: string): Promise<PendingLogin | null> {
  try {
    return await stateStore.get<PendingLogin>(`${KEY_PREFIX}verified:${token}`)
  } catch (error) {
    reportError(error, { area: "api", action: "two-factor-store.read-verified-login" })
    return null
  }
}

export async function clearVerifiedLogin(token: string): Promise<void> {
  await stateStore.delete(`${KEY_PREFIX}verified:${token}`).catch((error: unknown) => reportError(error, { area: "api", action: "two-factor-store.clear-verified-login" }))
}
