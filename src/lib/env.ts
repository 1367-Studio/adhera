export const APP_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000"

// Kept in sync with `basePath` in next.config.ts. window.location.origin has no way to
// know about it on its own, so any client-built absolute link (portal/check-in/site
// links, Stripe Elements return_url) must prepend this explicitly.
export const BASE_PATH = "/app"
