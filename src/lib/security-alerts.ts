import { sendEmail } from "@/lib/mail"
import { securityAlertEmail, escapeHtml } from "@/lib/email"
import { reportError } from "@/lib/monitoring"
import { claimOnce } from "@/lib/rate-limit"

// Security audit M1 — until now nothing in the codebase ever proactively told anyone about a
// critical security event; the only way to notice one was to go looking in Sentry/ActivityLog
// after the fact. Channel chosen by the user: plain email, to a single fixed ops address (not
// per-association — these two events are platform-level signals, not something an individual
// association's own admins need to see).
const SECURITY_ALERT_EMAIL = process.env.SECURITY_ALERT_EMAIL

async function dispatchSecurityAlert(heading: string, body: string): Promise<void> {
  if (!SECURITY_ALERT_EMAIL) {
    console.error(`[security-alerts] SECURITY_ALERT_EMAIL not configured — alert dropped: ${heading}`)
    return
  }
  try {
    await sendEmail(securityAlertEmail({ to: SECURITY_ALERT_EMAIL, heading, body }))
  } catch (error) {
    // Never thrown to the caller — a failed alert must not be mistaken for (or interrupt)
    // the security-relevant action that triggered it (a blocked login, a permission change).
    reportError(error, { area: "email", action: "security-alert.send", extra: { heading } })
  }
}

// Call right after rateLimit() returns false for `key` — fires exactly once per `windowMs`,
// via an atomic SET NX claim rather than peeking the counter and comparing it to `limit + 1`:
// under a real brute-force attempt (concurrent requests), several increments can land before
// any of them reads back, so the counter can skip straight past `limit + 1` and a peek-based
// check would never fire at all. The claim can't be missed the same way — exactly one caller
// ever wins it per window, no matter how many arrive at once.
export async function alertOnLoginRateLimitBreach(key: string, limit: number, windowMs: number, description: string): Promise<void> {
  try {
    if (!(await claimOnce(key, windowMs))) return
    await dispatchSecurityAlert(
      "Tentatives de connexion suspectes",
      `${escapeHtml(description)}<br>Limite de ${limit} tentatives dépassée sur une fenêtre de 15 minutes.`,
    )
  } catch (error) {
    reportError(error, { area: "email", action: "security-alert.rate-limit-check" })
  }
}

// Called from PATCH /api/equipe/[userId] only when the resolved `administrator` flag actually
// flips — a routine area-permission tweak (e.g. "membres" read → write) does not fire this.
export async function alertAdministratorPermissionChange(opts: {
  associationName: string
  targetName:      string
  actorName:       string
  granted:         boolean
}): Promise<void> {
  const verb = opts.granted ? "a reçu les droits administrateur" : "a perdu les droits administrateur"
  await dispatchSecurityAlert(
    "Changement de permission administrateur",
    `<strong>${escapeHtml(opts.targetName)}</strong> ${verb} sur l'association <strong>${escapeHtml(opts.associationName)}</strong>, action effectuée par ${escapeHtml(opts.actorName)}.`,
  )
}
