import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { bankAccountSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export async function GET() {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId } = ctx

  const accounts = await prisma.bankAccount.findMany({
    where:   { associationId },
    orderBy: { createdAt: "asc" },
  })
  return NextResponse.json(accounts)
}

export async function POST(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role, userId } = ctx

  if (!FINANCE.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

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
}
