// NEXTAUTH_URL must point at the auth API's own mount point (.../app/api/auth) — when it
// has a path, NextAuth treats that path as the mount point itself and won't insert
// "/api/auth" on its own, so the redirect_uri it sends Google ends up wrong without this.
// Everything else in the app wants the app's root instead, hence the strip below.
export const APP_URL = (process.env.NEXTAUTH_URL ?? "http://localhost:3000/api/auth").replace(/\/api\/auth$/, "")

// Kept in sync with `basePath` in next.config.ts. window.location.origin has no way to
// know about it on its own, so any client-built absolute link (portal/check-in/site
// links, Stripe Elements return_url) must prepend this explicitly.
export const BASE_PATH = "/app"
