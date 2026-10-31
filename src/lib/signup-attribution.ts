// Marketing attribution of a signup — which ad / keyword / referrer brought the visitor to
// /register. The marketing website (formwise.fr) appends these query params to its CTA
// links (https://app.formwise.fr/app/register?tier=…&plan=…&utm_source=…); the register
// form forwards them to POST /api/register, which writes them to the founder's signup
// Google Sheet (see src/lib/signup-sheet.ts). Purely informational: nothing here ever
// affects whether or how an account gets created.
//
// Imported by the "use client" register form as well as the API route, so it must stay
// free of server-only imports.

export const SIGNUP_ATTRIBUTION_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "gbraid",
  "wbraid",
  // Random id of the click on the marketing website, to match its click log.
  "fw_click",
  // Host of the visitor's original referrer on the website ("www.google.com", "chatgpt.com").
  "fw_ref",
] as const

export type SignupAttributionKey = (typeof SIGNUP_ATTRIBUTION_KEYS)[number]
export type SignupAttribution    = Partial<Record<SignupAttributionKey, string>>

// sessionStorage (not localStorage), same reasoning as the Google prefill in the register
// form: it only needs to survive a redirect/refresh within this visit (e.g. the Google
// sign-in round trip, which comes back to a bare /register and loses the original query).
export const SIGNUP_ATTRIBUTION_STORAGE_KEY = "fw_attribution"

const MAX_ATTRIBUTION_VALUE_LENGTH = 200

export function attributionFromSearchParams(searchParams: Pick<URLSearchParams, "get">): SignupAttribution | null {
  const attribution: SignupAttribution = {}
  let hasAnyValue = false
  for (const attributionKey of SIGNUP_ATTRIBUTION_KEYS) {
    const paramValue = searchParams.get(attributionKey)?.trim()
    if (paramValue) {
      attribution[attributionKey] = paramValue.slice(0, MAX_ATTRIBUTION_VALUE_LENGTH)
      hasAnyValue = true
    }
  }
  return hasAnyValue ? attribution : null
}

// Browser only. Storage access is wrapped because it throws in some privacy modes /
// sandboxed iframes — attribution must never get in the way of signing up.
export function storeSignupAttribution(attribution: SignupAttribution): void {
  try {
    sessionStorage.setItem(SIGNUP_ATTRIBUTION_STORAGE_KEY, JSON.stringify(attribution))
  } catch { /* storage unavailable — attribution is best-effort */ }
}

function readStoredSignupAttribution(): SignupAttribution | null {
  try {
    const storedValue = sessionStorage.getItem(SIGNUP_ATTRIBUTION_STORAGE_KEY)
    if (!storedValue) return null
    const parsedValue: unknown = JSON.parse(storedValue)
    if (!parsedValue || typeof parsedValue !== "object") return null
    const storedRecord = parsedValue as Record<string, unknown>
    const attribution: SignupAttribution = {}
    let hasAnyValue = false
    for (const attributionKey of SIGNUP_ATTRIBUTION_KEYS) {
      const storedEntry = storedRecord[attributionKey]
      if (typeof storedEntry === "string" && storedEntry) {
        attribution[attributionKey] = storedEntry.slice(0, MAX_ATTRIBUTION_VALUE_LENGTH)
        hasAnyValue = true
      }
    }
    return hasAnyValue ? attribution : null
  } catch {
    return null
  }
}

// Browser only, called at submit time: the current URL's params win, otherwise whatever
// was stashed on arrival. Returns undefined (not {}) so JSON.stringify drops the field.
export function readSignupAttribution(): SignupAttribution | undefined {
  try {
    const fromUrl = attributionFromSearchParams(new URLSearchParams(window.location.search))
    if (fromUrl) return fromUrl
  } catch { /* fall through to storage */ }
  return readStoredSignupAttribution() ?? undefined
}

// Same rules as the marketing website's own channel classification, so the sheet and the
// website's click log speak the same language. utm = utm_source, referrer = fw_ref.
export function signupChannel(attribution: SignupAttribution | null | undefined): string {
  const utmSource   = (attribution?.utm_source   ?? "").toLowerCase()
  const utmMedium   = (attribution?.utm_medium   ?? "").toLowerCase()
  const referrer    = (attribution?.fw_ref       ?? "").toLowerCase()
  const hasAdsClick = !!(attribution?.gclid || attribution?.gbraid || attribution?.wbraid)

  if (hasAdsClick || (utmSource === "google" && /cpc|ppc|paid/.test(utmMedium))) return "Google Ads"
  if (utmSource.includes("linkedin") || referrer.includes("linkedin")) return "LinkedIn"

  const socialPattern = /facebook|instagram|meta/
  if (socialPattern.test(utmSource) || socialPattern.test(referrer)) return "Réseaux sociaux"

  if (utmMedium === "email" || utmSource.includes("newsletter")) return "E-mail"

  const aiAssistantPattern = /chatgpt|openai|perplexity|claude|gemini|copilot|mistral/
  if (aiAssistantPattern.test(utmSource) || aiAssistantPattern.test(referrer)) return "IA (ChatGPT, Perplexity…)"

  if (/google|bing|duckduckgo|qwant|ecosia|yahoo/.test(referrer)) return "Recherche Google (SEO)"
  if (referrer) return "Site référent"
  return "Direct"
}
