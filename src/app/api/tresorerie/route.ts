import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { tresorerieSchema } from "@/lib/schemas"
import { parsePagination } from "@/lib/pagination"
import { writeActivityLog } from "@/lib/activity-log"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export async function GET(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId } = ctx

  const { searchParams } = new URL(req.url)
  const type     = searchParams.get("type") ?? undefined
  const year     = searchParams.get("year")
  const search   = searchParams.get("search")?.trim()

  const where: Record<string, unknown> = { associationId }
  if (type) where.type = type
  if (year) {
    const y = parseInt(year)
    if (!Number.isNaN(y)) {
      where.date = {
        gte: new Date(`${y}-01-01`),
        lt:  new Date(`${y + 1}-01-01`),
      }
    }
  }
  if (search) {
    where.OR = [
      { description: { contains: search, mode: "insensitive" } },
      { category:    { contains: search, mode: "insensitive" } },
    ]
  }

  const orderBy = { date: "desc" as const }

  // Year-scoped date filter (without type/search, for accurate yearly totals)
  const yearDateFilter = year && !Number.isNaN(parseInt(year)) ? {
    gte: new Date(`${parseInt(year)}-01-01`),
    lt:  new Date(`${parseInt(year) + 1}-01-01`),
  } : undefined

  async function computeStats() {
    const [entrees, sorties, entreesAnnee, sortiesAnnee] = await Promise.all([
      prisma.tresorerieEntry.aggregate({ where: { associationId, type: "ENTREE" }, _sum: { amount: true } }),
      prisma.tresorerieEntry.aggregate({ where: { associationId, type: "SORTIE" }, _sum: { amount: true } }),
      prisma.tresorerieEntry.aggregate({ where: { associationId, type: "ENTREE", ...(yearDateFilter ? { date: yearDateFilter } : {}) }, _sum: { amount: true } }),
      prisma.tresorerieEntry.aggregate({ where: { associationId, type: "SORTIE", ...(yearDateFilter ? { date: yearDateFilter } : {}) }, _sum: { amount: true } }),
    ])
    return {
      solde:     Number(entrees._sum.amount ?? 0) - Number(sorties._sum.amount ?? 0),
      recettes:  Number(entreesAnnee._sum.amount ?? 0),
      depenses:  Number(sortiesAnnee._sum.amount ?? 0),
    }
  }

  if (!searchParams.has("page")) {
    const [data, stats] = await Promise.all([
      prisma.tresorerieEntry.findMany({ where, orderBy }),
      computeStats(),
    ])
    return NextResponse.json({ data, ...stats })
  }

  const { page, limit, skip } = parsePagination(searchParams)
  const [data, total, stats] = await Promise.all([
    prisma.tresorerieEntry.findMany({ where, orderBy, skip, take: limit }),
    prisma.tresorerieEntry.count({ where }),
    computeStats(),
  ])

  return NextResponse.json({ data, total, page, limit, totalPages: Math.ceil(total / limit), ...stats })
}

export async function POST(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role, userId } = ctx

  if (!FINANCE.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const parsed = tresorerieSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { date, category, ...rest } = parsed.data
  const entry = await prisma.tresorerieEntry.create({
    data: {
      ...rest,
      associationId,
      date:     new Date(date),
      category: category || null,
    },
  })

  await writeActivityLog({ associationId, actorId: userId, action: "TRESORERIE_CREATED", entity: "Tresorerie", entityId: entry.id, label: entry.description, metadata: { type: entry.type, amount: Number(entry.amount) } })
  return NextResponse.json(entry, { status: 201 })
}
