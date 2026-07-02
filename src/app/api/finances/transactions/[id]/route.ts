import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { bankTransactionUpdateSchema } from "@/lib/schemas"
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
  const existing = await prisma.bankTransaction.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Transaction introuvable" }, { status: 404 })

  const body   = await req.json()
  const parsed = bankTransactionUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const tx = await prisma.bankTransaction.update({ where: { id }, data: { status: parsed.data.status } })
  await writeActivityLog({ associationId, actorId: userId, action: "BANK_TX_STATUS_UPDATED", entity: "BankTransaction", entityId: id, label: existing.label, metadata: { status: parsed.data.status } })
  return NextResponse.json(tx)
}
