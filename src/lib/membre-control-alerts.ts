import { sendEmail } from "@/lib/mail"
import { membreControlAlertStaffEmail } from "@/lib/email"
import { APP_URL } from "@/lib/env"
import { reportError } from "@/lib/monitoring"

type ControlAlertCandidate = {
  firstName:    string
  lastName:     string
  createdAt:    Date
  association:  { name: string }
}

// Fire-and-forget staff notification for the membre-control-alert-sweep cron (src/app/api/
// cron/membre-control-alert-sweep) — one digest email per sweep run, never one per member,
// so an outage that raises dozens of alerts at once doesn't flood the inbox. Never throws:
// this runs after the alert rows are already committed, so a mail failure must not make the
// sweep look like it failed.
export async function notifyStaffOfControlAlerts(candidates: ControlAlertCandidate[]): Promise<void> {
  const supportEmail = process.env.SUPPORT_TEAM_EMAIL
  if (!supportEmail) {
    console.error("[membre-control-alerts] SUPPORT_TEAM_EMAIL is not configured — staff notification email skipped")
    return
  }
  try {
    // No EmailContext here: unlike a support-ticket email, this digest is not scoped to a
    // single association (it can list members from several at once), so it's not logged
    // to EmailMessage — that table's history is per-association, not a platform-internal log.
    await sendEmail(membreControlAlertStaffEmail({
      to:           supportEmail,
      alerts:       candidates.map(c => ({ membreName: `${c.firstName} ${c.lastName}`, associationName: c.association.name, createdAt: c.createdAt })),
      dashboardUrl: `${APP_URL}/backoffice/control-alerts`,
    }))
  } catch (error) {
    reportError(error, { area: "email", action: "membre-control-alerts.notify-staff", extra: { count: candidates.length } })
  }
}
