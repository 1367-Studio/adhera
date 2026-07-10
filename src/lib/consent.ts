import { requestIp } from "@/lib/rate-limit"

// The service terms/privacy policy documents themselves live on the marketing site
// (form-wise-app), not duplicated here — see its src/app/[locale]/cgs and
// politique-de-confidentialite pages. CGS is the paid-service contract (for the /register
// signup, where the signer is the paying customer); the member-facing flows below only
// ever reference PRIVACY_URL — members aren't a party to that contract.
export const TERMS_URL   = "https://www.formwise.fr/cgs"
export const PRIVACY_URL = "https://www.formwise.fr/politique-de-confidentialite"

// Bump this (and update the linked documents on form-wise-app) whenever the terms
// materially change — stored per-acceptance alongside termsAcceptedAt so it's always known
// exactly which version a given signup agreed to, even after the docs are updated later.
export const CURRENT_TERMS_VERSION = "2026-07-10"

// requestIp() falls back to the literal string "unknown" (fine for its original use as a
// rate-limit bucket key, where every request needs *some* key) — not what we want to
// persist as evidence of consent, where "we don't actually know" should just be null.
export function consentIp(req: Request): string | null {
  const ip = requestIp(req)
  return ip === "unknown" ? null : ip
}
