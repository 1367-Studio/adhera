import { Redis } from "@upstash/redis"

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN

// Logged once per cold start (not per-request) — missing credentials is a deploy
// misconfiguration, not a transient blip, and unlike a Stripe env var going missing
// (which fails loudly on the next Stripe call) a missing Upstash config fails *silently*:
// every rate-limited route below just quietly stops being rate-limited. This is the one
// place that gets a chance to make that loud before it does.
if (!UPSTASH_URL || !UPSTASH_TOKEN) {
  console.error(
    "[rate-limit] MISCONFIGURED: UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN not set — " +
    "every rate-limited route (public forms, AI endpoints) is running with NO rate limiting until this is fixed."
  )
}

const redis = new Redis({ url: UPSTASH_URL!, token: UPSTASH_TOKEN! })

// Shares an Upstash account with the asr-temp project — every key here is namespaced so
// the two never collide in that one shared database.
const KEY_PREFIX = "adhera:ratelimit:"

// Redis-backed fixed-window rate limiter. Replaces a previous in-memory Map, which only
// tracked state within a single server process — on serverless (Vercel), each invocation
// can land on a different instance with its own separate memory, so that gave close to no
// real protection once traffic was actually distributed across instances.
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  const redisKey = `${KEY_PREFIX}${key}`
  try {
    // Both commands in one pipelined round-trip, not two separate awaits — an INCR that
    // succeeds followed by a PEXPIRE that never runs (network blip, timeout) would leave
    // the counter with no expiry at all, permanently stuck above the limit once it's ever
    // crossed. NX makes the expiry a no-op on every request after the first in the window,
    // instead of pushing it back and turning this into a sliding window.
    const [count] = await redis.pipeline()
      .incr(redisKey)
      .pexpire(redisKey, windowMs, "NX")
      .exec<[number, 0 | 1]>()
    return count <= limit
  } catch (err) {
    // Fail open — an Upstash outage shouldn't take every rate-limited route in the app
    // down with it. Distinct log line from the misconfiguration case above: this one means
    // credentials are set but the call itself failed (network/outage/bad response), a
    // transient condition rather than a standing deploy error.
    console.error("[rate-limit] Redis call failed, allowing request through:", err)
    return true
  }
}

export function requestIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")
  return forwarded?.split(",")[0]?.trim() || "unknown"
}

// Reads the current count in a fixed window without incrementing it — used to check whether
// a variable-cost operation (e.g. N audio-seconds) fits inside what's left of the budget
// *before* spending it. Unlike rateLimit()/INCR, this never creates or extends the window on
// its own — a key that doesn't exist yet just reads as 0 usage so far.
export async function rateLimitPeek(key: string): Promise<number> {
  try {
    return (await redis.get<number>(`${KEY_PREFIX}${key}`)) ?? 0
  } catch (err) {
    console.error("[rate-limit] Redis call failed, assuming 0 usage:", err)
    return 0
  }
}

// Adds `amount` to a fixed-window counter, creating the window (with its expiry) on first
// use — the "spend" half of the peek-then-spend pattern above. Callers are expected to have
// already checked rateLimitPeek() before calling this; it doesn't enforce a limit itself.
export async function consumeQuota(key: string, amount: number, windowMs: number): Promise<void> {
  try {
    await redis.pipeline()
      .incrby(`${KEY_PREFIX}${key}`, amount)
      .pexpire(`${KEY_PREFIX}${key}`, windowMs, "NX")
      .exec()
  } catch (err) {
    console.error("[rate-limit] Redis call failed while consuming quota:", err)
  }
}
