import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { importColumnMappingSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { Prisma } from "@prisma/client"
import { guardModule } from "@/lib/auth/require-module"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export async function POST(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role, userId } = ctx

  const guard = await guardModule(associationId, "finances")
  if (guard) return guard
  if (!FINANCE.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body   = await req.json()
  const { rows, mapping: rawMapping } = body as { rows: unknown[]; mapping: unknown }

  const mappingParsed = importColumnMappingSchema.safeParse(rawMapping)
  if (!mappingParsed.success) {
    return NextResponse.json({ error: mappingParsed.error.issues }, { status: 422 })
  }

  const mapping = mappingParsed.data

  const account = await prisma.bankAccount.findFirst({
    where: { id: mapping.bankAccountId, associationId },
  })
  if (!account) {
    return NextResponse.json({ error: "Compte bancaire introuvable" }, { status: 404 })
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "Aucune ligne à importer" }, { status: 422 })
  }

  let imported   = 0
  let duplicates = 0
  let errors     = 0

  for (const row of rows as Array<{ transactionDate: string; label: string; amount: number; type: "CREDIT" | "DEBIT"; balanceAfter?: number; externalId: string }>) {
    // Basic server-side validation: reject zero or negative amounts
    if (!row.amount || row.amount <= 0 || !row.label?.trim() || !row.transactionDate) {
      errors++
      continue
    }

    try {
      await prisma.bankTransaction.create({
        data: {
          associationId,
          bankAccountId:   mapping.bankAccountId,
          transactionDate: new Date(row.transactionDate),
          label:           row.label,
          amount:          row.amount,
          type:            row.type,
          balanceAfter:    row.balanceAfter ?? null,
          externalId:      row.externalId,
          status:          "UNMATCHED",
          rawData:         row as object,
        },
      })
      imported++
    } catch (err) {
      // Only treat unique constraint violations (P2002) as duplicates
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        duplicates++
      } else {
        // Any other error (connection, type, FK) is a real failure
        errors++
      }
    }
  }

  if (imported > 0) {
    const latestWithBalance = await prisma.bankTransaction.findFirst({
      where:   { bankAccountId: mapping.bankAccountId, balanceAfter: { not: null } },
      orderBy: [{ transactionDate: "desc" }, { createdAt: "desc" }],
    })

    let currentBalance: Prisma.Decimal | number
    if (latestWithBalance?.balanceAfter != null) {
      currentBalance = latestWithBalance.balanceAfter
    } else {
      const [credit, debit] = await Promise.all([
        prisma.bankTransaction.aggregate({ where: { bankAccountId: mapping.bankAccountId, type: "CREDIT", status: { not: "DUPLICATE" } }, _sum: { amount: true } }),
        prisma.bankTransaction.aggregate({ where: { bankAccountId: mapping.bankAccountId, type: "DEBIT",  status: { not: "DUPLICATE" } }, _sum: { amount: true } }),
      ])
      currentBalance = Number(account.openingBalance) + Number(credit._sum.amount ?? 0) - Number(debit._sum.amount ?? 0)
    }

    await prisma.bankAccount.update({ where: { id: mapping.bankAccountId }, data: { currentBalance } })
  }

  await writeActivityLog({
    associationId,
    actorId: userId,
    action: "BANK_STATEMENT_IMPORTED",
    entity: "BankTransaction",
    label: account.accountName,
    metadata: { imported, duplicates, errors, total: rows.length },
  })

  return NextResponse.json({ imported, duplicates, errors, toReconcile: imported })
}
