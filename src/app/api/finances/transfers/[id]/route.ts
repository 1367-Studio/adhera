import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { accountTransferSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { resolveExerciceForDate, closedExerciceGuard } from "@/lib/finance/exercice"

type TxClient = Prisma.TransactionClient

const accountSelect = { id: true, accountName: true, bankName: true, currency: true } as const
const accountSelectWithStatus = { ...accountSelect, isActive: true } as const

// Shared by PATCH and DELETE — a transfer's reconciled legs point at a specific amount/
// accounts/date; changing or removing the transfer makes those matches stale, so both
// release them the same way UNMATCH already does (drop the BankReconciliation rows, put
// their BankTransaction back to UNMATCHED) rather than leaving a dangling or wrong match.
async function releaseTransferReconciliations(tx: TxClient, transferId: string) {
  const reconciliations = await tx.bankReconciliation.findMany({ where: { transferId }, select: { id: true, bankTransactionId: true } })
  if (reconciliations.length === 0) return
  await tx.bankReconciliation.deleteMany({ where: { transferId } })
  await tx.bankTransaction.updateMany({
    where: { id: { in: reconciliations.map(r => r.bankTransactionId) } },
    data:  { status: "UNMATCHED" },
  })
}

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.accountTransfer.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Transfert introuvable" }, { status: 404 })

  const existingGuard = closedExerciceGuard((await resolveExerciceForDate(associationId, existing.date))?.status)
  if (existingGuard) return existingGuard

  const body   = await req.json()
  const parsed = accountTransferSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }
  const { fromAccountId, toAccountId, amount, note } = parsed.data
  const date = new Date(parsed.data.date)

  const [fromAccount, toAccount] = await Promise.all([
    prisma.bankAccount.findFirst({ where: { id: fromAccountId, associationId }, select: accountSelectWithStatus }),
    prisma.bankAccount.findFirst({ where: { id: toAccountId, associationId }, select: accountSelectWithStatus }),
  ])
  if (!fromAccount) return NextResponse.json({ error: "Compte source introuvable" }, { status: 404 })
  if (!toAccount) return NextResponse.json({ error: "Compte destination introuvable" }, { status: 404 })
  if (fromAccount.currency !== toAccount.currency) {
    return NextResponse.json({ error: `Les comptes source et destination doivent avoir la même devise (${fromAccount.currency} / ${toAccount.currency})` }, { status: 422 })
  }

  const exercice = await resolveExerciceForDate(associationId, date)
  const exerciceGuard = closedExerciceGuard(exercice?.status)
  if (exerciceGuard) return exerciceGuard

  const transfer = await prisma.$transaction(async (tx) => {
    await releaseTransferReconciliations(tx, id)
    return tx.accountTransfer.update({
      where: { id },
      data:  { exerciceId: exercice?.id ?? null, fromAccountId, toAccountId, amount, date, note: note || null },
      include: { fromAccount: { select: accountSelect }, toAccount: { select: accountSelect } },
    })
  })

  await writeActivityLog({
    associationId, actorId: userId, action: "ACCOUNT_TRANSFER_UPDATED", entity: "AccountTransfer", entityId: id,
    label: `${fromAccount.accountName} → ${toAccount.accountName}`,
    metadata: { amount },
  })
  return NextResponse.json(transfer)
}, { area: "comptabilite", module: "finances" })

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.accountTransfer.findFirst({
    where:   { id, associationId },
    include: { fromAccount: { select: { accountName: true } }, toAccount: { select: { accountName: true } } },
  })
  if (!existing) return NextResponse.json({ error: "Transfert introuvable" }, { status: 404 })

  const exerciceGuard = closedExerciceGuard((await resolveExerciceForDate(associationId, existing.date))?.status)
  if (exerciceGuard) return exerciceGuard

  await prisma.$transaction(async (tx) => {
    await releaseTransferReconciliations(tx, id)
    await tx.accountTransfer.delete({ where: { id } })
  })

  await writeActivityLog({
    associationId, actorId: userId, action: "ACCOUNT_TRANSFER_DELETED", entity: "AccountTransfer", entityId: id,
    label: `${existing.fromAccount.accountName} → ${existing.toAccount.accountName}`,
  })
  return new NextResponse(null, { status: 204 })
}, { area: "comptabilite", module: "finances" })
