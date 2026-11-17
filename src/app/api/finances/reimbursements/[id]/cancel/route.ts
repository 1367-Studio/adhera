import { NextResponse } from "next/server"
import type { ReimbursementStatus } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { reimbursementCancelSchema } from "@/lib/schemas"
import { withAdminAuth } from "@/lib/api-wrapper"
import { writeActivityLog } from "@/lib/activity-log"
import { canManageReimbursements } from "@/lib/finance/reimbursement-access"
import { reverseReimbursementApproval } from "@/lib/finance/journal/post-reimbursement"

// Two different callers, two different rules:
//  - the requester themselves can withdraw an already-submitted request
//    (PENDING_APPROVAL/NEEDS_CORRECTION) — no reversal needed, nothing was ever posted. A
//    DRAFT never submitted has nothing to withdraw — that's a plain delete (DELETE /[id]),
//    not a cancellation kept in history.
//  - an approver can cancel an already-APPROVED request, but only with a reason, and this
//    reverses whatever ACCRUAL-regime posting happened at approval time (see the ticket's
//    "any cancellation after approval must be an authorized, logged action with accounting
//    regularization when necessary").
export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId, permissions } = ctx

  const request = await prisma.reimbursementRequest.findFirst({ where: { id, associationId } })
  if (!request) return NextResponse.json({ error: "Demande introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => ({}))
  const parsed = reimbursementCancelSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }
  const { reason } = parsed.data

  const isOwner = request.requesterId === userId
  const isManager = canManageReimbursements(permissions)

  let sourceStatuses: ReimbursementStatus[]
  if (request.status === "PENDING_APPROVAL" || request.status === "NEEDS_CORRECTION") {
    if (!isOwner) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    sourceStatuses = ["PENDING_APPROVAL", "NEEDS_CORRECTION"]
  } else if (request.status === "APPROVED") {
    if (!isManager) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
    if (!reason) return NextResponse.json({ error: "Un motif est requis pour annuler une demande déjà approuvée" }, { status: 422 })
    sourceStatuses = ["APPROVED"]
  } else {
    return NextResponse.json({ error: "Cette demande ne peut plus être annulée" }, { status: 409 })
  }

  // Atomic compare-and-swap, same reasoning as approve/route.ts — claimed BEFORE the ledger
  // reversal below runs, so a concurrent duplicate call can't both pass the status check and
  // both attempt the reversal (reverseReimbursementApproval is idempotent on its own via each
  // entry's reversal idempotencyKey, but there's no reason to rely on that as the only guard).
  const claim = await prisma.reimbursementRequest.updateMany({
    where: { id, associationId, status: { in: sourceStatuses } },
    data:  { status: "CANCELLED", cancelledAt: new Date(), cancelledByUserId: userId },
  })
  if (claim.count === 0) {
    return NextResponse.json({ error: "Cette demande ne peut plus être annulée" }, { status: 409 })
  }

  if (request.status === "APPROVED") {
    await reverseReimbursementApproval(id)
  }

  const updated = await prisma.reimbursementRequest.findUniqueOrThrow({ where: { id } })

  await writeActivityLog({ associationId, actorId: userId, action: "REIMBURSEMENT_CANCELLED", entity: "ReimbursementRequest", entityId: id, label: request.subject, metadata: reason ? { reason } : undefined })
  return NextResponse.json(updated)
}, { module: "reimbursements" })
