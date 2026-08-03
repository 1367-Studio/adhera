import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { exerciceComptableSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { findOverlappingExercice, findExerciceGap, derivePattern, expectedRangeForYear, exclusiveEndOfDay } from "@/lib/finance/exercice"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export const GET = withAdminAuth(async (_req, ctx) => {
  const { associationId } = ctx

  const exercices = await prisma.exerciceComptable.findMany({
    where:   { associationId },
    orderBy: { startDate: "asc" },
    include: { _count: { select: { incomes: true, expenses: true, bankTransactions: true } } },
  })
  // Flattened into a single number for the delete-confirmation UI — the breakdown by record
  // type doesn't matter there, only "how much is riding on this".
  const withRecordCount = exercices.map(({ _count, ...e }) => ({
    ...e,
    recordCount: _count.incomes + _count.expenses + _count.bankTransactions,
  }))
  return NextResponse.json(withRecordCount)
}, { roles: FINANCE, module: "finances" })

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body   = await req.json()
  const parsed = exerciceComptableSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }
  const { label, startDate, endDate, confirmGap } = parsed.data
  const range = { startDate: new Date(startDate), endDate: new Date(endDate) }

  const existing = await prisma.exerciceComptable.findMany({
    where:  { associationId },
    select: { id: true, label: true, startDate: true, endDate: true, createdAt: true },
  })

  const overlap = findOverlappingExercice(existing, range)
  if (overlap) {
    return NextResponse.json({
      error: `Chevauche l'exercice "${overlap.label}" (${overlap.startDate.toLocaleDateString("fr-FR")} – ${overlap.endDate.toLocaleDateString("fr-FR")})`,
    }, { status: 409 })
  }

  // Checked before the (confirmable) gap warning below — pattern mismatch isn't something a
  // user can confirm past, so there's no point walking them through confirming a gap only to
  // then hit a second, unrelated rejection on the resend. Le premier exercice de l'association
  // fixe librement le calendrier fiscal — tous les suivants doivent reproduire le même motif
  // jour/mois de début et de fin, translaté d'année en année. "Premier" = le premier réellement
  // créé (createdAt), pas le plus ancien par startDate : on ne recrée jamais d'exercice
  // antérieur déjà clos.
  if (existing.length > 0) {
    const founding = [...existing].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]
    const pattern  = derivePattern(founding)
    const expected = expectedRangeForYear(pattern, range.startDate.getUTCFullYear())

    if (range.startDate.getTime() !== expected.startDate.getTime() || range.endDate.getTime() !== expected.endDate.getTime()) {
      return NextResponse.json({
        error:             "Les dates ne correspondent pas au calendrier fiscal déjà établi.",
        code:              "PATTERN_MISMATCH",
        expectedStartDate: expected.startDate,
        expectedEndDate:   expected.endDate,
      }, { status: 422 })
    }
  }

  if (!confirmGap) {
    const gap = findExerciceGap(existing, range)
    if (gap) {
      return NextResponse.json({
        error:    "Il existe un écart entre cet exercice et le précédent/suivant — confirmez pour continuer.",
        code:     "GAP_WARNING",
        gapDays:  gap.gapDays,
        gapStart: gap.gapStart,
        gapEnd:   gap.gapEnd,
      }, { status: 422 })
    }
  }

  const { exercice, linkedRecords } = await prisma.$transaction(async (tx) => {
    const created = await tx.exerciceComptable.create({
      data: { associationId, label, startDate: range.startDate, endDate: range.endDate },
    })

    const rangeEnd = exclusiveEndOfDay(range.endDate)
    const incomes = await tx.income.updateMany({
      where: { associationId, exerciceId: null, date: { gte: range.startDate, lt: rangeEnd } },
      data:  { exerciceId: created.id },
    })
    const expenses = await tx.expense.updateMany({
      where: { associationId, exerciceId: null, date: { gte: range.startDate, lt: rangeEnd } },
      data:  { exerciceId: created.id },
    })
    const bankTxs = await tx.bankTransaction.updateMany({
      where: { associationId, exerciceId: null, transactionDate: { gte: range.startDate, lt: rangeEnd } },
      data:  { exerciceId: created.id },
    })

    return { exercice: created, linkedRecords: incomes.count + expenses.count + bankTxs.count }
  })

  await writeActivityLog({
    associationId, actorId: userId, action: "EXERCICE_CREATED", entity: "ExerciceComptable", entityId: exercice.id, label: exercice.label,
    ...(linkedRecords > 0 ? { metadata: { linkedRecords } } : {}),
  })
  return NextResponse.json({ ...exercice, linkedRecords }, { status: 201 })
}, { roles: FINANCE, module: "finances" })
