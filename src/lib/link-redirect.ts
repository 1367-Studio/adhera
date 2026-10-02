// Resend's deliverability checker (and most spam filters) flags a link whose domain
// doesn't match the sending domain — a common, expected case for Formwise since
// associations routinely link out to their own website, a fundraising page, social
// media, etc. from a template button/image. Routing those external destinations through
// this same-domain redirect keeps every link an email actually shows pointing at
// APP_URL, satisfying that check without forcing admins to avoid external links.
// See wrapExternalLink() below and its caller in src/lib/email-blocks.ts.
import { createHmac, timingSafeEqual } from "crypto"
import { APP_URL } from "@/lib/env"

// NEXTAUTH_SECRET is already a required, server-only secret — reused here instead of
// introducing a second one just for this.
const SECRET = process.env.NEXTAUTH_SECRET ?? ""

function sign(url: string): string {
  return createHmac("sha256", SECRET).update(url).digest("base64url")
}

// The signature is what keeps /api/public/go from being an open redirect: only a URL
// this app itself signed (at template-render time, below) can come back out as a
// redirect target — an attacker can't swap in an arbitrary `u` without the matching `s`.
export function verifyLinkSignature(url: string, signature: string): boolean {
  const expected = Buffer.from(sign(url))
  const given     = Buffer.from(signature)
  return expected.length === given.length && timingSafeEqual(expected, given)
}

// Leaves the URL untouched if it already matches the app's own domain, or isn't
// http(s) (mailto:/tel: carry no domain-mismatch risk and can't be redirected through a
// GET route anyway).
export function wrapExternalLink(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return url
  if (parsed.origin === new URL(APP_URL).origin) return url

  const params = new URLSearchParams({ u: url, s: sign(url) })
  return `${APP_URL}/api/public/go?${params.toString()}`
}
