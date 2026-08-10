// NEXTAUTH_URL must point at the auth API's own mount point (.../app/api/auth) — when it
// has a path, NextAuth treats that path as the mount point itself and won't insert
// "/api/auth" on its own, so the redirect_uri it sends Google ends up wrong without this.
// Everything else in the app wants the app's root instead, hence the strip below.
//
// A dozen+ email/webhook links now derive their domain from APP_URL, so a malformed
// NEXTAUTH_URL must fail loudly at boot in production instead of quietly shipping dead
// links — trim a stray trailing slash first so it doesn't defeat the /api/auth strip.
//
// This module is also imported client-side (for BASE_PATH, by plenty of "use client"
// components and instrumentation-client.ts) — NEXTAUTH_URL is never inlined into the
// browser bundle (only NEXT_PUBLIC_* vars are) while NODE_ENV always is, so without the
// `typeof window` guard this throws on every single page load in production.
const rawNextAuthUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, "")
if (typeof window === "undefined" && process.env.NODE_ENV === "production" && !rawNextAuthUrl?.endsWith("/api/auth")) {
  throw new Error(`NEXTAUTH_URL must end with "/api/auth" (got: ${rawNextAuthUrl ?? "unset"})`)
}
export const APP_URL = (rawNextAuthUrl ?? "http://localhost:3000/api/auth").replace(/\/api\/auth$/, "")

// Kept in sync with `basePath` in next.config.ts. window.location.origin has no way to
// know about it on its own, so any client-built absolute link (portal/check-in/site
// links, Stripe Elements return_url) must prepend this explicitly.
export const BASE_PATH = "/app"
