import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { parsePagination } from "@/lib/pagination"
import { withAdminAuth } from "@/lib/api-wrapper"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export const GET = withAdminAuth(async (req, ctx) => {
  if (!FINANCE.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const { associationId } = ctx
  const { searchParams } = new URL(req.url)

  const year   = searchParams.get("year")
  const search = searchParams.get("search")?.trim()

  const where: Record<string, unknown> = {
    associationId,
    paidAt: { not: null },
  }

  if (year) {
    const y = parseInt(year)
    if (!Number.isNaN(y)) {
      where.paidAt = {
        gte: new Date(`${y}-01-01`),
        lt:  new Date(`${y + 1}-01-01`),
      }
    }
  }

  if (search) {
    where.OR = [
      { firstName:   { contains: search, mode: "insensitive" } },
      { lastName:    { contains: search, mode: "insensitive" } },
      { companyName: { contains: search, mode: "insensitive" } },
      { email:       { contains: search, mode: "insensitive" } },
      { message:     { contains: search, mode: "insensitive" } },
    ]
  }

  const orderBy = { paidAt: "desc" as const }

  const { page, limit, skip } = parsePagination(searchParams)
  const [data, total] = await Promise.all([
    prisma.don.findMany({ where, orderBy, skip, take: limit }),
    prisma.don.count({ where }),
  ])

  const aggregate = await prisma.don.aggregate({
    where: { associationId, paidAt: { not: null }, ...(year ? {
      paidAt: {
        gte: new Date(`${year}-01-01`),
        lt:  new Date(`${parseInt(year) + 1}-01-01`),
      },
    } : {}) },
    _sum:   { amount: true },
    _count: { id: true },
  })

  return NextResponse.json({
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    totalAmount: Number(aggregate._sum.amount ?? 0),
    totalCount:  aggregate._count.id,
  })
})
