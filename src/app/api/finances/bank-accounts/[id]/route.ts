import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { bankAccountUpdateSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { guardModule } from "@/lib/auth/require-module"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role, userId } = ctx

  const guard = await guardModule(associationId, "finances")
  if (guard) return guard
  if (!FINANCE.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
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
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role, userId } = ctx

  const guard = await guardModule(associationId, "finances")
  if (guard) return guard
  if (!FINANCE.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
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
}
