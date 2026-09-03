import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { membershipSignupAdminNotificationEmail } from "@/lib/email"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { pusherServer } from "@/lib/pusher-server"
import { APP_URL } from "@/lib/env"
import { findPossibleDuplicates } from "@/lib/membre-duplicates"

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
  // Set when this signup is a MembershipForm.validationMode === "REQUEST" free-tier request
  // (see checkout/route.ts's willBeImmediate) — the Membre exists as PENDING, not yet a real
  // member, so both channels below need to read as "review this" rather than "FYI, done".
  pendingValidation?: boolean
  // Every Membre this signup created, for the duplicate sweep below. Defaults to the primary
  // one, which is the whole answer on every single-registrant path; only a group submission
  // has more than one to check.
  membreIds?: string[]
}): Promise<void> {
  const admins = await prisma.user.findMany({
    where:  { associationId: params.associationId, role: { in: ["ADMIN", "PRESIDENT", "TRESORIER"] }, active: true },
    select: { id: true },
  })

  const isGroup = params.memberNames.length > 1
  const title   = params.pendingValidation
    ? (isGroup ? "Demande d'inscription groupée à valider" : "Demande d'adhésion à valider")
    : (isGroup ? "Nouvelle inscription groupée" : "Nouvelle adhésion")
  const body    = params.pendingValidation
    ? `${params.memberNames.join(", ")} ${isGroup ? "attendent" : "attend"} votre validation pour rejoindre via « ${params.formTitle} ».`
    : `${params.memberNames.join(", ")} ${isGroup ? "ont rejoint" : "a rejoint"} via « ${params.formTitle} ».`

  if (admins.length) {
    await prisma.notification.createMany({
      data: admins.map(a => ({ userId: a.id, title, body, link: "/dashboard/membres", scope: "GESTION" })),
      skipDuplicates: true,
    })
    await pusherServer.trigger(`private-association-${params.associationId}`, "new-notification", {}).catch(() => {})
  }

  // A separate notification from the signup one above, and deliberately after it: this is a
  // "someone should check" flag, not part of the good news. Never shown to the visitor — a
  // public form that confirms who is already a member is a queryable membership directory
  // (see lib/membre-duplicates.ts). Wrapped in its own try: a signup that really happened
  // matters more than a hint that it might be a double, so a failure here stays silent.
  const membreIds = params.membreIds ?? (params.primaryMembreId ? [params.primaryMembreId] : [])
  if (admins.length && membreIds.length) {
    try {
      const duplicates = await findPossibleDuplicates(params.associationId, membreIds)
      if (duplicates.length) {
        const lines = duplicates.map(d =>
          `${d.membreName} (${d.reason === "name" ? "même nom et prénom" : "même numéro de téléphone"})`)
        await prisma.notification.createMany({
          data: admins.map(a => ({
            userId: a.id,
            title:  duplicates.length > 1 ? "Doublons possibles" : "Doublon possible",
            body:   `${lines.join(", ")} — une fiche existante correspond déjà. Vérifiez avant de garder deux adhésions.`,
            link:   `/dashboard/membres/${duplicates[0].membreId}`,
            scope:  "GESTION",
          })),
          skipDuplicates: true,
        })
        await pusherServer.trigger(`private-association-${params.associationId}`, "new-notification", {}).catch(() => {})
      }
    } catch (err) {
      console.error(`[membership-notify] duplicate sweep failed for association ${params.associationId}:`, err)
    }
  }

  if (!params.adminNotificationEmail) return

  const assoc = await prisma.association.findUnique({
    where:  { id: params.associationId },
    select: { name: true, plan: true, customBrandingEnabled: true, logoUrl: true },
  })
  if (!assoc) return

  // Awaited: callers that themselves await notifyMembershipSignup (e.g. the Stripe webhook)
  // need this to actually finish before the request ends, or the send can get torn down by
  // Vercel's serverless runtime before Resend is called — same confirmed pattern as da57b4f.
  await sendEmail(membershipSignupAdminNotificationEmail({
    email:           params.adminNotificationEmail,
    associationName: assoc.name,
    formTitle:       params.formTitle,
    memberNames:     params.memberNames,
    amount:          params.amount,
    dashboardUrl:    `${APP_URL}/dashboard/membres`,
    branding:        resolveDocumentBranding(assoc),
    pendingValidation: params.pendingValidation,
  }), { associationId: params.associationId, membreId: params.primaryMembreId, source: "TRANSACTION" }).catch(() => {})
}
