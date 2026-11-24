import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { reimbursementApproveSchema } from "@/lib/schemas"
import { withAdminAuth } from "@/lib/api-wrapper"
import { writeActivityLog } from "@/lib/activity-log"
import { canApproveRequest } from "@/lib/finance/reimbursement-access"
import { notifyRequesterOfDecision } from "@/lib/finance/reimbursement-notify"
import { postReimbursementApproval } from "@/lib/finance/journal/post-reimbursement"
import { resolveExerciceForDate, closedExerciceGuard } from "@/lib/finance/exercice"

export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId, permissions } = ctx

  const request = await prisma.reimbursementRequest.findFirst({
    where:   { id, associationId },
    include: { items: true },
  })
  if (!request) return NextResponse.json({ error: "Demande introuvable" }, { status: 404 })
  // "Nobody can approve their own request, even with management permission, except an
  // administrator" — enforced by canApproveRequest itself.
  if (!canApproveRequest(permissions, userId, request.requesterId)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }
  if (request.status !== "PENDING_APPROVAL") {
    return NextResponse.json({ error: "Cette demande n'est pas en attente d'approbation" }, { status: 409 })
  }

  const body   = await req.json().catch(() => ({}))
  const parsed = reimbursementApproveSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }
  const corrections = (parsed.data.categoryCorrections ?? [])
    .filter(c => request.items.some(item => item.id === c.itemId))

  const association = await prisma.association.findUnique({ where: { id: associationId }, select: { accountingRegime: true } })

  // ACCRUAL regime posts to the ledger right now (see postReimbursementApproval) — a closed
  // exercice on any item's date must block the whole approval, same posture as every other
  // write into a closed period. A missing exercice (none covers that date yet) does NOT
  // block — it's left for the lazy catch-up, same contract as postExpenseToJournal.
  if (association?.accountingRegime === "ACCRUAL") {
    for (const item of request.items) {
      const exercice = await resolveExerciceForDate(associationId, item.date)
      const guard = await closedExerciceGuard(exercice?.status)
      if (guard) return guard
    }
  }

  // Atomic compare-and-swap: the WHERE clause only matches while status is still
  // PENDING_APPROVAL, so of several concurrent Approve calls on the same request (two tabs,
  // a double-click the client-side loading-disable didn't catch, a direct API call), only one
  // can ever win this update. Losers get a clean 409 instead of silently re-running the whole
  // approval (redundant category corrections, redundant postReimbursementApproval work).
  const claim = await prisma.reimbursementRequest.updateMany({
    where: { id, associationId, status: "PENDING_APPROVAL" },
    data:  { status: "APPROVED", decidedAt: new Date(), decidedByUserId: userId },
  })
  if (claim.count === 0) {
    return NextResponse.json({ error: "Cette demande n'est pas en attente d'approbation" }, { status: 409 })
  }

  for (const correction of corrections) {
    const item = request.items.find(i => i.id === correction.itemId)!
    if (item.categoryId === correction.categoryId) continue
    await prisma.reimbursementItem.update({ where: { id: correction.itemId }, data: { categoryId: correction.categoryId } })
    await writeActivityLog({
      associationId, actorId: userId, action: "REIMBURSEMENT_ITEM_CATEGORY_CORRECTED", entity: "ReimbursementItem", entityId: correction.itemId,
      metadata: { oldCategoryId: item.categoryId, newCategoryId: correction.categoryId },
    })
  }

  if (association?.accountingRegime === "ACCRUAL") {
    await postReimbursementApproval(id)
  }

  await notifyRequesterOfDecision(id, "APPROVED")
  await writeActivityLog({ associationId, actorId: userId, action: "REIMBURSEMENT_APPROVED", entity: "ReimbursementRequest", entityId: id, label: request.subject })

  const updated = await prisma.reimbursementRequest.findUnique({ where: { id } })
  return NextResponse.json(updated)
}, { module: "reimbursements" })
