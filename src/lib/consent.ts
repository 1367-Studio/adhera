import { requestIp } from "@/lib/rate-limit"
import { latestSanityUpdateVersion } from "@/lib/legal/sanity-version"

// The privacy policy document itself lives on the marketing site (formwise-latest,
// Sanity-backed), not duplicated here — see its privacy-policy page. Members aren't a party
// to the /register signup's own contract (see LEGAL_DOCUMENTS_PAGE_URL in
// src/lib/legal/platform-documents.ts for that one), so the member-facing flows below only
// ever reference PRIVACY_URL.
export const PRIVACY_URL = "https://www.formwise.fr/fr/privacy-policy/"

const PRIVACY_POLICY_SANITY_ID = "tr-3a0d4261-21c6-40ca-94d1-6539718a2c47" // politique-de-confidentialite

// Stored per-acceptance alongside termsAcceptedAt, so it's always known exactly which
// version of the privacy policy a given signup agreed to — read live from Sanity's
// _updatedAt (cached 1h) rather than a string a developer has to remember to bump whenever
// the page changes on formwise-latest.
export function getCurrentTermsVersion(): Promise<string> {
  return latestSanityUpdateVersion([PRIVACY_POLICY_SANITY_ID], "2026-07-10")
}

// requestIp() falls back to the literal string "unknown" (fine for its original use as a
// rate-limit bucket key, where every request needs *some* key) — not what we want to
// persist as evidence of consent, where "we don't actually know" should just be null.
export function consentIp(req: Request): string | null {
  const ip = requestIp(req)
  return ip === "unknown" ? null : ip
}
