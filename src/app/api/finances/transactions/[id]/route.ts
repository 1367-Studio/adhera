import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { bankTransactionUpdateSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

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
}, { roles: FINANCE, module: "finances" })
