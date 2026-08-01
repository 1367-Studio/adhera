// src/app/api/finances/exercices/[id]/route.ts
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { exerciceComptableUpdateSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.exerciceComptable.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Exercice introuvable" }, { status: 404 })

  const body   = await req.json()
  const parsed = exerciceComptableUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  // Schema only exposes label/status — startDate/endDate are immutable post-creation and
  // aren't accepted here at all, so no extra guard is needed against tampering with them.
  const { label, status } = parsed.data
  const statusChanged = status !== undefined && status !== existing.status
  const closing       = statusChanged && status === "CLOTURE"

  // A period can only be closed once its own calendar range is over — otherwise a
  // real-time event (e.g. a Stripe payment landing "today") could still fall inside the
  // range of an already-closed period.
  if (closing && new Date() < existing.endDate) {
    return NextResponse.json({ error: "EARLY_CLOSURE", endDate: existing.endDate }, { status: 422 })
  }

  const { exercice, linkedRecords } = await prisma.$transaction(async (tx) => {
    // Safety net: link any Income/Expense/BankTransaction that fell inside this period's
    // dates but never got an exerciceId (created before the exercice existed, or by a
    // creation path that doesn't resolve one). Runs before the actual closure so the
    // period is complete once it's locked, regardless of how a record got orphaned.
    let linkedRecords = 0
    if (closing) {
      const incomes = await tx.income.updateMany({
        where: { associationId, exerciceId: null, date: { gte: existing.startDate, lte: existing.endDate } },
        data:  { exerciceId: id },
      })
      const expenses = await tx.expense.updateMany({
        where: { associationId, exerciceId: null, date: { gte: existing.startDate, lte: existing.endDate } },
        data:  { exerciceId: id },
      })
      const bankTxs = await tx.bankTransaction.updateMany({
        where: { associationId, exerciceId: null, transactionDate: { gte: existing.startDate, lte: existing.endDate } },
        data:  { exerciceId: id },
      })
      linkedRecords = incomes.count + expenses.count + bankTxs.count
    }

    const exercice = await tx.exerciceComptable.update({
      where: { id },
      data: {
        ...(label  !== undefined ? { label } : {}),
        ...(status !== undefined ? { status } : {}),
        // Only stamp/clear closedAt on an actual OUVERT<->CLOTURE transition — resending the
        // same status must not overwrite a real closing timestamp.
        ...(statusChanged ? { closedAt: status === "CLOTURE" ? new Date() : null } : {}),
      },
    })

    return { exercice, linkedRecords }
  })

  const action = !statusChanged ? "EXERCICE_UPDATED" : status === "CLOTURE" ? "EXERCICE_CLOTURE" : "EXERCICE_REOUVERT"
  await writeActivityLog({
    associationId, actorId: userId, action, entity: "ExerciceComptable", entityId: id, label: exercice.label,
    ...(linkedRecords > 0 ? { metadata: { linkedRecords } } : {}),
  })
  return NextResponse.json({ ...exercice, linkedRecords })
}, { roles: FINANCE, module: "finances" })

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.exerciceComptable.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Exercice introuvable" }, { status: 404 })

  if (existing.status === "CLOTURE") {
    return NextResponse.json({ error: "Cet exercice est clôturé — réouvrez-le avant de le supprimer." }, { status: 409 })
  }

  // onDelete: SetNull unlinks these automatically — nothing here is destroyed, only
  // detached back to "no exercice", the same state they were in before this exercice
  // existed. Counted up front purely to leave a readable trail in the activity log.
  const [incomeCount, expenseCount, bankTxCount] = await Promise.all([
    prisma.income.count({ where: { exerciceId: id } }),
    prisma.expense.count({ where: { exerciceId: id } }),
    prisma.bankTransaction.count({ where: { exerciceId: id } }),
  ])

  await prisma.exerciceComptable.delete({ where: { id } })

  await writeActivityLog({
    associationId, actorId: userId, action: "EXERCICE_DELETED",
    entity: "ExerciceComptable", entityId: id, label: existing.label,
    metadata: { incomeCount, expenseCount, bankTxCount },
  })
  return new NextResponse(null, { status: 204 })
}, { roles: FINANCE, module: "finances" })
