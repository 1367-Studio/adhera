import { NextResponse } from "next/server"
import { verifyLinkSignature } from "@/lib/link-redirect"
import { rateLimit } from "@/lib/rate-limit"

// Keeps every link inside a Formwise email pointing at the app's own domain (see
// wrapExternalLink in src/lib/link-redirect.ts) even when an admin's template button or
// image actually links out to a third-party site. The signature check is what stops
// this from being an open redirect — see verifyLinkSignature's own comment.
export async function GET(req: Request) {
  const url         = new URL(req.url)
  const destination = url.searchParams.get("u")
  const signature   = url.searchParams.get("s")
  if (!destination || !signature || !verifyLinkSignature(destination, signature)) {
    return NextResponse.json({ error: "Invalid link" }, { status: 400 })
  }

  // Keyed by destination, not IP — the same button gets clicked by many different
  // recipients, same reasoning as the public asset route's rate limit.
  if (!(await rateLimit(`public-link-redirect:${destination}`, 1000, 10 * 60_000))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 })
  }

  return NextResponse.redirect(destination, { status: 302 })
}
