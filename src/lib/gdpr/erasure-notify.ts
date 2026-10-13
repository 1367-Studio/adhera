import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { erasureRequestAdminNotificationEmail } from "@/lib/email"
import { resolveEmailBranding } from "@/lib/plan-limits"
import { getAdministratorEmails } from "@/lib/team-access"
import { reportError } from "@/lib/monitoring"
import { APP_URL } from "@/lib/env"

// Notifies every OTHER administrator of the association at each stage of an ErasureRequest's
// lifecycle (security audit H6) — without this, an irreversible action can move forward with
// only the one admin who acted aware it's even queued. Never throws: called after the state
// change that matters is already committed, same fire-and-forget convention as the member-
// facing emails in ../../app/api/erasure-requests/.
export async function notifyAdministratorsOfErasureRequest(opts: {
  associationId:    string
  erasureRequestId: string
  membreId:         string
  membreName:       string
  event:            "created" | "review_requested" | "retention_triggered" | "approved" | "held" | "released" | "cancelled" | "completed"
  heldReason?:      string | null
  // Omit for the cron's "completed" and "retention_triggered" events, and for
  // "review_requested" — in all three cases the actor isn't one of the association's
  // administrators (the cron, or the member themselves from the portal), so there's nobody
  // on the admin side to leave out.
  excludeUserId?:   string
}): Promise<void> {
  try {
    const [adminEmails, association] = await Promise.all([
      getAdministratorEmails(opts.associationId, opts.excludeUserId),
      prisma.association.findUnique({ where: { id: opts.associationId }, select: { name: true } }),
    ])
    if (adminEmails.length === 0 || !association) return

    const branding     = await resolveEmailBranding(opts.associationId)
    const dashboardUrl = `${APP_URL}/dashboard/parametres?tab=rgpd`

    await Promise.all(adminEmails.map(to => sendEmail(erasureRequestAdminNotificationEmail({
      to,
      associationName: association.name,
      membreName:       opts.membreName,
      event:            opts.event,
      heldReason:       opts.heldReason,
      dashboardUrl,
      branding,
    }), { associationId: opts.associationId, membreId: opts.membreId, source: "ERASURE_REQUEST", sourceId: opts.erasureRequestId })))
  } catch (error) {
    reportError(error, {
      area:  "email",
      action: "erasure-request.admin-notification",
      extra: { associationId: opts.associationId, membreId: opts.membreId, event: opts.event },
    })
  }
}
