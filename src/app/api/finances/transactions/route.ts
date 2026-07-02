import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { parsePagination } from "@/lib/pagination"
import { withAdminAuth } from "@/lib/api-wrapper"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const { searchParams } = new URL(req.url)
  const status        = searchParams.get("status")        ?? undefined
  const bankAccountId = searchParams.get("bankAccountId") ?? undefined
  const type          = searchParams.get("type")          ?? undefined
  const dateFrom      = searchParams.get("dateFrom")      ?? undefined
  const dateTo        = searchParams.get("dateTo")        ?? undefined

  const where: Record<string, unknown> = { associationId }
  if (status)        where.status        = status
  if (bankAccountId) where.bankAccountId = bankAccountId
  if (type)          where.type          = type
  if (dateFrom || dateTo) {
    where.transactionDate = {
      ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo   ? { lte: new Date(dateTo) }   : {}),
    }
  }

  const include = {
    bankAccount:     { select: { accountName: true, bankName: true } },
    reconciliations: {
      include: {
        income:  { select: { id: true, description: true, amount: true, memberId: true, membre: { select: { firstName: true, lastName: true } } } },
        expense: { select: { id: true, description: true, vendor: true, amount: true } },
      },
    },
  }

  const orderBy = { transactionDate: "desc" as const }

  const { page, limit, skip } = parsePagination(searchParams, 50)
  const [data, total] = await Promise.all([
    prisma.bankTransaction.findMany({ where, orderBy, skip, take: limit, include }),
    prisma.bankTransaction.count({ where }),
  ])

  return NextResponse.json({ data, total, page, limit, totalPages: Math.ceil(total / limit) })
}, { roles: FINANCE, module: "finances" })
