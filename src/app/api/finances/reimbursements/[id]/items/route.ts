import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { reimbursementItemSchema } from "@/lib/schemas"
import { withAdminAuth } from "@/lib/api-wrapper"
import { recomputeRequestTotal, findDuplicateItem } from "@/lib/finance/reimbursement-helpers"

export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const request = await prisma.reimbursementRequest.findFirst({ where: { id, associationId } })
  if (!request) return NextResponse.json({ error: "Demande introuvable" }, { status: 404 })
  if (request.requesterId !== userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }
  if (request.status !== "DRAFT" && request.status !== "NEEDS_CORRECTION") {
    return NextResponse.json({ error: "Cette demande ne peut plus être modifiée" }, { status: 409 })
  }

  const body   = await req.json()
  const parsed = reimbursementItemSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }
  const { date, description, amount, categoryId, receiptUrl, receiptFileName, isImmobilisation } = parsed.data
  const itemDate = new Date(date)

  const maxOrder = await prisma.reimbursementItem.aggregate({
    where: { reimbursementRequestId: id },
    _max:  { order: true },
  })

  const item = await prisma.reimbursementItem.create({
    data: {
      reimbursementRequestId: id,
      date:        itemDate,
      description,
      amount,
      categoryId,
      receiptUrl,
      receiptFileName: receiptFileName || null,
      isImmobilisation,
      order: (maxOrder._max.order ?? -1) + 1,
    },
  })
  await recomputeRequestTotal(id)

  const duplicate = await findDuplicateItem(associationId, request.requesterId, itemDate, amount, item.id)
  return NextResponse.json({ ...item, duplicateWarning: !!duplicate }, { status: 201 })
}, { module: "reimbursements" })
