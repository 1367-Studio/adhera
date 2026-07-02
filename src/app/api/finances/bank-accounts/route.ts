import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { bankAccountSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export const GET = withAdminAuth(async (_req, ctx) => {
  const { associationId } = ctx

  const accounts = await prisma.bankAccount.findMany({
    where:   { associationId },
    orderBy: { createdAt: "asc" },
  })
  return NextResponse.json(accounts)
}, { roles: FINANCE, module: "finances" })

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body   = await req.json()
  const parsed = bankAccountSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { openingBalance, ...rest } = parsed.data
  const account = await prisma.bankAccount.create({
    data: {
      ...rest,
      associationId,
      openingBalance,
      currentBalance: openingBalance,
      ibanLast4: rest.ibanLast4 || null,
    },
  })

  await writeActivityLog({ associationId, actorId: userId, action: "BANK_ACCOUNT_CREATED", entity: "BankAccount", entityId: account.id, label: account.accountName })
  return NextResponse.json(account, { status: 201 })
}, { roles: FINANCE, module: "finances" })
