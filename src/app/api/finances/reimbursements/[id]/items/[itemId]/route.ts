import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { reimbursementItemUpdateSchema } from "@/lib/schemas"
import { withAdminAuth } from "@/lib/api-wrapper"
import { recomputeRequestTotal, findDuplicateItem } from "@/lib/finance/reimbursement-helpers"

async function loadEditableItem(associationId: string, userId: string, requestId: string, itemId: string) {
  const item = await prisma.reimbursementItem.findFirst({
    where:   { id: itemId, reimbursementRequestId: requestId },
    include: { request: true },
  })
  if (!item || item.request.associationId !== associationId) return { error: NextResponse.json({ error: "Élément introuvable" }, { status: 404 }) }
  if (item.request.requesterId !== userId) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 403 }) }
  if (item.request.status !== "DRAFT" && item.request.status !== "NEEDS_CORRECTION") {
    return { error: NextResponse.json({ error: "Cette demande ne peut plus être modifiée" }, { status: 409 }) }
  }
  return { item }
}

export const PATCH = withAdminAuth<{ id: string; itemId: string }>(async (req, ctx, { id, itemId }) => {
  const { associationId, userId } = ctx

  const { item, error } = await loadEditableItem(associationId, userId, id, itemId)
  if (error) return error

  const body   = await req.json()
  const parsed = reimbursementItemUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }
  const { date, description, amount, categoryId, receiptUrl, receiptFileName, isImmobilisation } = parsed.data

  const updated = await prisma.reimbursementItem.update({
    where: { id: itemId },
    data: {
      ...(date        !== undefined ? { date: new Date(date) } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(amount       !== undefined ? { amount } : {}),
      ...(categoryId   !== undefined ? { categoryId } : {}),
      ...(receiptUrl   !== undefined ? { receiptUrl } : {}),
      ...(receiptFileName !== undefined ? { receiptFileName: receiptFileName || null } : {}),
      ...(isImmobilisation !== undefined ? { isImmobilisation } : {}),
    },
  })
  await recomputeRequestTotal(id)

  const duplicate = await findDuplicateItem(associationId, item!.request.requesterId, updated.date, Number(updated.amount), updated.id)
  return NextResponse.json({ ...updated, duplicateWarning: !!duplicate })
}, { module: "reimbursements" })

export const DELETE = withAdminAuth<{ id: string; itemId: string }>(async (_req, ctx, { id, itemId }) => {
  const { associationId, userId } = ctx

  const { error } = await loadEditableItem(associationId, userId, id, itemId)
  if (error) return error

  await prisma.reimbursementItem.delete({ where: { id: itemId } })
  await recomputeRequestTotal(id)

  return new NextResponse(null, { status: 204 })
}, { module: "reimbursements" })
