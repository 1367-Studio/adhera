// FORM-93 — notifies the right people at each step of the reimbursement workflow. Same
// two-step shape as src/lib/evenement-notify.ts (in-app Notification + Pusher nudge), except
// the recipient list for a submission can't be a fixed role allowlist like that module's
// ADMIN/PRESIDENT/TRESORIER: who can approve here also depends on the per-user "reimbursements"
// area grant (see reimbursement-access.ts), so it's computed per staff member instead.
import { prisma } from "@/lib/prisma/client"
import { pusherServer } from "@/lib/pusher-server"
import { reportError } from "@/lib/monitoring"
import { resolvePermissions, STAFF_ROLES } from "@/lib/permissions"
import { canManageReimbursements } from "@/lib/finance/reimbursement-access"

async function notifyPusher(associationId: string, action: string) {
  await pusherServer.trigger(`private-association-${associationId}`, "new-notification", {}).catch((error: unknown) =>
    reportError(error, { area: "api", action: `reimbursement-notify.${action}-pusher`, extra: { associationId } }),
  )
}

// Called right after a request moves to PENDING_APPROVAL. Notifies every staff member who can
// manage reimbursements (TRESORIER by default, anyone else granted the area), excluding the
// requester themselves — approving your own request is never allowed, so there's no point
// notifying them about their own submission.
export async function notifyApproversOfSubmission(requestId: string): Promise<void> {
  const request = await prisma.reimbursementRequest.findUnique({
    where:   { id: requestId },
    include: { requester: { select: { name: true } } },
  })
  if (!request) return

  const staff = await prisma.user.findMany({
    where:  { associationId: request.associationId, role: { in: [...STAFF_ROLES] }, active: true },
    select: { id: true, role: true, permissions: true },
  })
  const approverIds = staff
    .filter(u => u.id !== request.requesterId && canManageReimbursements(resolvePermissions(u.role, u.permissions)))
    .map(u => u.id)
  if (approverIds.length === 0) return

  await prisma.notification.createMany({
    data: approverIds.map(userId => ({
      userId,
      title:    "Demande de remboursement à approuver",
      body:     `${request.requester.name ?? "Un membre de l'équipe"} a soumis une demande de remboursement « ${request.subject} » (${Number(request.totalAmount).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}).`,
      link:     `/dashboard/reimbursements/${request.id}`,
      scope:    "GESTION",
      groupKey: `reimbursement:${request.id}:submitted`,
    })),
    skipDuplicates: true,
  })
  await notifyPusher(request.associationId, "submission")
}

export type ReimbursementDecisionKind = "NEEDS_CORRECTION" | "APPROVED" | "REJECTED" | "REIMBURSED"

const DECISION_TITLES: Record<ReimbursementDecisionKind, string> = {
  NEEDS_CORRECTION: "Demande de remboursement à corriger",
  APPROVED:         "Demande de remboursement approuvée",
  REJECTED:         "Demande de remboursement refusée",
  REIMBURSED:       "Remboursement effectué",
}

// Called right after a request's status changes to one of the four decision outcomes.
// `note` carries the mandatory comment/justification for NEEDS_CORRECTION/REJECTED — included
// in the notification body so the requester doesn't have to open the request just to see why.
export async function notifyRequesterOfDecision(
  requestId: string, kind: ReimbursementDecisionKind, note?: string | null,
): Promise<void> {
  const request = await prisma.reimbursementRequest.findUnique({ where: { id: requestId } })
  if (!request) return

  const bodyByKind: Record<ReimbursementDecisionKind, string> = {
    NEEDS_CORRECTION: `Votre demande « ${request.subject} » doit être corrigée : ${note ?? ""}`,
    APPROVED:         `Votre demande « ${request.subject} » a été approuvée, en attente de remboursement.`,
    REJECTED:         `Votre demande « ${request.subject} » a été refusée : ${note ?? ""}`,
    REIMBURSED:       `Votre demande « ${request.subject} » a été remboursée.`,
  }

  await prisma.notification.create({
    data: {
      userId: request.requesterId,
      title:  DECISION_TITLES[kind],
      body:   bodyByKind[kind],
      link:   `/dashboard/reimbursements/${request.id}`,
      scope:  "GESTION",
    },
  })
  await notifyPusher(request.associationId, "decision")
}
