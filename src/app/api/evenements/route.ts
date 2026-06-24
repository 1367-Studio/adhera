import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { evenementSchema } from "@/lib/schemas"
import { parsePagination } from "@/lib/pagination"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

export async function GET(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId } = ctx

  const { searchParams } = new URL(req.url)
  const search    = searchParams.get("search")?.trim()
  const upcoming  = searchParams.get("upcoming") === "true"

  const from = searchParams.get("from")
  const to   = searchParams.get("to")

  const where: Record<string, unknown> = { associationId }
  if (upcoming) where.date = { gte: new Date() }
  else if (from || to) {
    where.date = {
      ...(from ? { gte: new Date(from) } : {}),
      ...(to   ? { lte: new Date(to)   } : {}),
    }
  }
  if (search) {
    where.OR = [
      { title:    { contains: search, mode: "insensitive" } },
      { location: { contains: search, mode: "insensitive" } },
    ]
  }

  const orderBy = upcoming
    ? { date: "asc" as const }
    : { date: "desc" as const }

  if (!searchParams.has("page")) {
    const data = await prisma.evenement.findMany({
      where,
      orderBy,
      include: { _count: { select: { participations: { where: { present: true } } } } },
    })
    return NextResponse.json(data)
  }

  const { page, limit, skip } = parsePagination(searchParams)
  const [data, total] = await Promise.all([
    prisma.evenement.findMany({
      where, orderBy, skip, take: limit,
      include: { _count: { select: { participations: { where: { present: true } } } } },
    }),
    prisma.evenement.count({ where }),
  ])
  return NextResponse.json({ data, total, page, limit, totalPages: Math.ceil(total / limit) })
}

export async function POST(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role } = ctx

  if (!MANAGERS.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const parsed = evenementSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { date, endDate, description, location, lat, lng, price, capacity, ...rest } = parsed.data
  const evenement = await prisma.evenement.create({
    data: {
      ...rest,
      associationId,
      date:        new Date(date),
      endDate:     endDate  ? new Date(endDate)  : null,
      description: description || null,
      location:    location    || null,
      lat:         lat      ?? null,
      lng:         lng      ?? null,
      price:       price    ?? null,
      capacity:    capacity ?? null,
    },
  })

  return NextResponse.json(evenement, { status: 201 })
}
