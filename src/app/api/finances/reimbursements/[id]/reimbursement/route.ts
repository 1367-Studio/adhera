import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { reimbursementRegisterSchema } from "@/lib/schemas"
import { withAdminAuth } from "@/lib/api-wrapper"
import { writeActivityLog } from "@/lib/activity-log"
import { canManageReimbursements } from "@/lib/finance/reimbursement-access"
import { notifyRequesterOfDecision } from "@/lib/finance/reimbursement-notify"
import { postReimbursementSettlement } from "@/lib/finance/journal/post-reimbursement"
import { resolveExerciceForDate, closedExerciceGuard } from "@/lib/finance/exercice"
import { computeMatchScore } from "@/lib/finance/match-score"

export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId, permissions } = ctx

  if (!canManageReimbursements(permissions)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  const request = await prisma.reimbursementRequest.findFirst({ where: { id, associationId } })
  if (!request) return NextResponse.json({ error: "Demande introuvable" }, { status: 404 })
  if (request.status !== "APPROVED") {
    return NextResponse.json({ error: "Cette demande n'est pas approuvée" }, { status: 409 })
  }

  const body   = await req.json()
  const parsed = reimbursementRegisterSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }
  const { date, paymentMethod, bankAccountId, reference, bankTransactionId } = parsed.data
  const reimbursementDate = new Date(date)

  const exercice = await resolveExerciceForDate(associationId, reimbursementDate)
  const guard = closedExerciceGuard(exercice?.status)
  if (guard) return guard

  let bankTransaction: { id: string; amount: unknown; transactionDate: Date; label: string } | null = null
  if (bankTransactionId) {
    bankTransaction = await prisma.bankTransaction.findFirst({
      where:  { id: bankTransactionId, associationId, status: { not: "MATCHED" } },
      select: { id: true, amount: true, transactionDate: true, label: true },
    })
    if (!bankTransaction) return NextResponse.json({ error: "Transaction bancaire introuvable ou déjà conciliée" }, { status: 404 })
  }

  // Reimbursement.reimbursementRequestId is @unique, so a concurrent duplicate call (two
  // tabs, a double-click) hitting tx.reimbursement.create for the same request rolls the
  // whole transaction back on a P2002 — financial correctness is already guaranteed by the
  // DB constraint; the catch below only turns that into a clean 409 instead of a raw 500.
  let reimbursement
  try {
    reimbursement = await prisma.$transaction(async (tx) => {
      const created = await tx.reimbursement.create({
        data: {
          associationId,
          reimbursementRequestId: id,
          date:          reimbursementDate,
          paymentMethod,
          bankAccountId: bankAccountId || null,
          reference:     reference     || null,
          registeredByUserId: userId,
        },
      })
      await tx.reimbursementRequest.update({ where: { id }, data: { status: "REIMBURSED" } })

      if (bankTransaction) {
        const matchScore = computeMatchScore(
          { amount: bankTransaction.amount as never, transactionDate: bankTransaction.transactionDate, label: bankTransaction.label },
          { amount: request.totalAmount as never, date: reimbursementDate },
        )
        await tx.bankReconciliation.create({
          data: {
            associationId,
            bankTransactionId: bankTransaction.id,
            reimbursementRequestId: id,
            matchScore,
            matchedBy:       "USER",
            matchedByUserId: userId,
          },
        })
        await tx.bankTransaction.update({ where: { id: bankTransaction.id }, data: { status: "MATCHED" } })
      }

      return created
    })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "Cette demande a déjà été remboursée" }, { status: 409 })
    }
    throw err
  }

  await postReimbursementSettlement(reimbursement.id)
  await notifyRequesterOfDecision(id, "REIMBURSED")
  await writeActivityLog({ associationId, actorId: userId, action: "REIMBURSEMENT_REGISTERED", entity: "ReimbursementRequest", entityId: id, label: request.subject, metadata: { amount: Number(request.totalAmount), paymentMethod } })

  return NextResponse.json(reimbursement, { status: 201 })
}, { module: "reimbursements" })
