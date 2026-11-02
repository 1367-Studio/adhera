import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { accountTransferSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { resolveExerciceForDate, closedExerciceGuard } from "@/lib/finance/exercice"

const accountSelect = { id: true, accountName: true, bankName: true, currency: true } as const
const accountSelectWithStatus = { ...accountSelect, isActive: true } as const

export const GET = withAdminAuth(async (_req, ctx) => {
  const { associationId } = ctx

  const transfers = await prisma.accountTransfer.findMany({
    where:   { associationId },
    orderBy: { date: "desc" },
    include: { fromAccount: { select: accountSelect }, toAccount: { select: accountSelect } },
  })
  return NextResponse.json(transfers)
}, { area: "comptabilite", module: "finances" })

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

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
  if (!fromAccount.isActive) return NextResponse.json({ error: "Le compte source est inactif" }, { status: 422 })
  if (!toAccount.isActive) return NextResponse.json({ error: "Le compte destination est inactif" }, { status: 422 })
  // No FX conversion exists on AccountTransfer (a single `amount` with no rate) — a
  // cross-currency transfer would silently misrepresent the amount on one side.
  if (fromAccount.currency !== toAccount.currency) {
    return NextResponse.json({ error: `Les comptes source et destination doivent avoir la même devise (${fromAccount.currency} / ${toAccount.currency})` }, { status: 422 })
  }

  const exercice = await resolveExerciceForDate(associationId, date)
  const exerciceGuard = closedExerciceGuard(exercice?.status)
  if (exerciceGuard) return exerciceGuard

  const transfer = await prisma.accountTransfer.create({
    data: {
      associationId,
      exerciceId: exercice?.id ?? null,
      fromAccountId,
      toAccountId,
      amount,
      date,
      note: note || null,
    },
    include: { fromAccount: { select: accountSelect }, toAccount: { select: accountSelect } },
  })

  await writeActivityLog({
    associationId, actorId: userId, action: "ACCOUNT_TRANSFER_CREATED", entity: "AccountTransfer", entityId: transfer.id,
    label: `${fromAccount.accountName} → ${toAccount.accountName}`,
    metadata: { amount },
  })
  return NextResponse.json(transfer, { status: 201 })
}, { area: "comptabilite", module: "finances" })
