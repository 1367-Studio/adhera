import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { writeActivityLog } from "@/lib/activity-log"
import { notifyApproversOfSubmission } from "@/lib/finance/reimbursement-notify"

export const POST = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const request = await prisma.reimbursementRequest.findFirst({
    where:   { id, associationId },
    include: { items: { select: { id: true } } },
  })
  if (!request) return NextResponse.json({ error: "Demande introuvable" }, { status: 404 })
  if (request.requesterId !== userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }
  if (request.status !== "DRAFT" && request.status !== "NEEDS_CORRECTION") {
    return NextResponse.json({ error: "Cette demande ne peut plus être soumise" }, { status: 409 })
  }
  // Every item already enforces categoryId/receiptUrl/amount>0/description at creation time
  // (see reimbursementItemSchema) — the only thing left to check here is that at least one
  // item actually exists.
  if (request.items.length === 0) {
    return NextResponse.json({ error: "Ajoutez au moins une dépense avant de soumettre la demande" }, { status: 422 })
  }

  // Atomic compare-and-swap — see approve/route.ts's own comment for why this matters: a
  // double-click or two open tabs submitting the same request must not both succeed and both
  // fire a round of approver notifications.
  const claim = await prisma.reimbursementRequest.updateMany({
    where: { id, associationId, status: { in: ["DRAFT", "NEEDS_CORRECTION"] } },
    data:  { status: "PENDING_APPROVAL", submittedAt: new Date() },
  })
  if (claim.count === 0) {
    return NextResponse.json({ error: "Cette demande ne peut plus être soumise" }, { status: 409 })
  }
  const updated = await prisma.reimbursementRequest.findUniqueOrThrow({ where: { id } })

  await notifyApproversOfSubmission(id)
  await writeActivityLog({ associationId, actorId: userId, action: "REIMBURSEMENT_SUBMITTED", entity: "ReimbursementRequest", entityId: id, label: request.subject })

  return NextResponse.json(updated)
}, { module: "reimbursements" })
