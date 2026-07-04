import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { bankAccountUpdateSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.bankAccount.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Compte introuvable" }, { status: 404 })

  const body   = await req.json()
  const parsed = bankAccountUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const account = await prisma.bankAccount.update({
    where: { id },
    data:  { ...parsed.data, ibanLast4: parsed.data.ibanLast4 ?? undefined },
  })

  await writeActivityLog({ associationId, actorId: userId, action: "BANK_ACCOUNT_UPDATED", entity: "BankAccount", entityId: id, label: account.accountName })
  return NextResponse.json(account)
}, { roles: FINANCE, module: "finances" })

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.bankAccount.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Compte introuvable" }, { status: 404 })

  const txCount = await prisma.bankTransaction.count({ where: { bankAccountId: id } })
  if (txCount > 0) {
    return NextResponse.json(
      { error: `Impossible de supprimer : ce compte contient ${txCount} transaction(s) importée(s).` },
      { status: 409 },
    )
  }

  await prisma.bankAccount.delete({ where: { id } })
  await writeActivityLog({ associationId, actorId: userId, action: "BANK_ACCOUNT_DELETED", entity: "BankAccount", entityId: id, label: existing.accountName })
  return new NextResponse(null, { status: 204 })
}, { roles: FINANCE, module: "finances" })
