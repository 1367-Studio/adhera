import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { membershipSignupAdminNotificationEmail } from "@/lib/email"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { pusherServer } from "@/lib/pusher-server"
import { APP_URL } from "@/lib/env"

// Called once per successful MembershipForm signup (every kind: free/offline/ONE_OFF/
// RECURRING, single or multi-registrant) — the one place this fires, so every checkout path
// stays in sync instead of each one growing its own copy. Two independent channels:
//
// 1. An in-app Notification to every ADMIN/PRESIDENT/TRESORIER, unconditionally — until this
//    existed, a successful signup only ever produced a MEMBRE_CREATED activity-log line, which
//    nobody sees unless they go looking for it.
// 2. An email to MembershipForm.adminNotificationEmail, only when a form explicitly sets one
//    (opt-in, mirrors AssoConnect's own "email de notification" field) — for a staff member
//    who wants a real email the moment it happens, not just a notification bell.
export async function notifyMembershipSignup(params: {
  associationId: string
  formTitle:     string
  adminNotificationEmail?: string | null
  memberNames:   string[] // 1 for a single registrant, N for a group submission
  amount:        number
  // Only used to link the email's audit log entry to a real Membre — omit for a group
  // submission's admin email, which already names everyone in the body.
  primaryMembreId?: string
}): Promise<void> {
  const admins = await prisma.user.findMany({
    where:  { associationId: params.associationId, role: { in: ["ADMIN", "PRESIDENT", "TRESORIER"] }, active: true },
    select: { id: true },
  })

  const isGroup = params.memberNames.length > 1
  const title   = isGroup ? "Nouvelle inscription groupée" : "Nouvelle adhésion"
  const body    = `${params.memberNames.join(", ")} ${isGroup ? "ont rejoint" : "a rejoint"} via « ${params.formTitle} ».`

  if (admins.length) {
    await prisma.notification.createMany({
      data: admins.map(a => ({ userId: a.id, title, body, link: "/dashboard/membres", scope: "GESTION" })),
      skipDuplicates: true,
    })
    await pusherServer.trigger(`private-association-${params.associationId}`, "new-notification", {}).catch(() => {})
  }

  if (!params.adminNotificationEmail) return

  const assoc = await prisma.association.findUnique({
    where:  { id: params.associationId },
    select: { name: true, plan: true, customBrandingEnabled: true, logoUrl: true },
  })
  if (!assoc) return

  sendEmail(membershipSignupAdminNotificationEmail({
    email:           params.adminNotificationEmail,
    associationName: assoc.name,
    formTitle:       params.formTitle,
    memberNames:     params.memberNames,
    amount:          params.amount,
    dashboardUrl:    `${APP_URL}/dashboard/membres`,
    branding:        resolveDocumentBranding(assoc),
  }), { associationId: params.associationId, membreId: params.primaryMembreId, source: "TRANSACTION" }).catch(() => {})
}
