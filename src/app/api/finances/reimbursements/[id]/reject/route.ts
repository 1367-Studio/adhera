import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { reimbursementDecisionNoteSchema } from "@/lib/schemas"
import { withAdminAuth } from "@/lib/api-wrapper"
import { writeActivityLog } from "@/lib/activity-log"
import { canApproveRequest } from "@/lib/finance/reimbursement-access"
import { notifyRequesterOfDecision } from "@/lib/finance/reimbursement-notify"

export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId, permissions } = ctx

  const request = await prisma.reimbursementRequest.findFirst({ where: { id, associationId } })
  if (!request) return NextResponse.json({ error: "Demande introuvable" }, { status: 404 })
  if (!canApproveRequest(permissions, userId, request.requesterId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }
  if (request.status !== "PENDING_APPROVAL") {
    return NextResponse.json({ error: "Cette demande n'est pas en attente d'approbation" }, { status: 409 })
  }

  const body   = await req.json()
  const parsed = reimbursementDecisionNoteSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }
  const { note } = parsed.data

  // REJECTED is terminal — kept in history, never reactivated (same posture as every other
  // terminal status in this workflow). Atomic compare-and-swap, same reasoning as
  // approve/route.ts — a concurrent duplicate call gets a clean 409 instead of double-firing
  // the requester notification.
  const claim = await prisma.reimbursementRequest.updateMany({
    where: { id, associationId, status: "PENDING_APPROVAL" },
    data:  { status: "REJECTED", rejectionReason: note, decidedAt: new Date(), decidedByUserId: userId },
  })
  if (claim.count === 0) {
    return NextResponse.json({ error: "Cette demande n'est pas en attente d'approbation" }, { status: 409 })
  }
  const updated = await prisma.reimbursementRequest.findUniqueOrThrow({ where: { id } })

  await notifyRequesterOfDecision(id, "REJECTED", note)
  await writeActivityLog({ associationId, actorId: userId, action: "REIMBURSEMENT_REJECTED", entity: "ReimbursementRequest", entityId: id, label: request.subject, metadata: { note } })

  return NextResponse.json(updated)
}, { module: "reimbursements" })
