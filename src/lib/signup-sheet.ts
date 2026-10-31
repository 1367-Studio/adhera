import { reportError } from "@/lib/monitoring"
import { signupChannel, type SignupAttribution } from "@/lib/signup-attribution"

// Appends one row per successful account creation to the founder's signup Google Sheet,
// through a Google Apps Script web app (HTTP POST, JSON body, shared secret in the body).
// Both env vars are optional: unset (local dev, staging) → silently skipped.
//
// Never allowed to break or meaningfully slow down registration: bounded by a short
// timeout and every failure is reported, never thrown.
const SIGNUP_SHEET_TIMEOUT_MS = 4000

type SignupSheetInput = {
  associationId:   string
  associationName: string
  city?:           string
  firstName:       string
  lastName:        string
  email:           string
  // "offre" for a custom-pricing offer signup, which has no catalog tier/plan.
  tier:            "starter" | "essential" | "pro" | "offre"
  plan:            "monthly" | "yearly" | "offre"
  locale?:         string
  attribution?:    SignupAttribution
}

export async function recordSignupInSheet(input: SignupSheetInput): Promise<void> {
  const webhookUrl = process.env.SIGNUP_SHEET_WEBHOOK_URL
  const secret     = process.env.SIGNUP_SHEET_SECRET
  if (!webhookUrl || !secret) return

  const attribution = input.attribution ?? {}
  const row = {
    secret,
    type:         "signup",
    date:         new Date().toISOString(),
    association:  input.associationName,
    city:         input.city ?? "",
    firstName:    input.firstName,
    lastName:     input.lastName,
    email:        input.email,
    tier:         input.tier,
    plan:         input.plan,
    channel:      signupChannel(attribution),
    utm_source:   attribution.utm_source   ?? "",
    utm_medium:   attribution.utm_medium   ?? "",
    utm_campaign: attribution.utm_campaign ?? "",
    utm_term:     attribution.utm_term     ?? "",
    utm_content:  attribution.utm_content  ?? "",
    gclid:        attribution.gclid        ?? "",
    referrer:     attribution.fw_ref       ?? "",
    click_id:     attribution.fw_click     ?? "",
    locale:       input.locale ?? "",
  }

  try {
    // Apps Script answers with a 302 to the script's output — fetch's default redirect
    // following handles it.
    const response = await fetch(webhookUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(row),
      signal:  AbortSignal.timeout(SIGNUP_SHEET_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`Signup sheet webhook answered HTTP ${response.status}`)
  } catch (error) {
    reportError(error, { area: "api", action: "register.signup-sheet", extra: { associationId: input.associationId } })
  }
}
