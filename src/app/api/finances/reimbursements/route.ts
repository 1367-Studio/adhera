import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { reimbursementRequestSchema } from "@/lib/schemas"
import { parsePagination } from "@/lib/pagination"
import { withAdminAuth } from "@/lib/api-wrapper"
import { canViewAllReimbursements } from "@/lib/finance/reimbursement-access"

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId, userId, permissions } = ctx

  const { searchParams } = new URL(req.url)
  const requesterIdParam = searchParams.get("requesterId") ?? undefined
  const statusParam      = searchParams.get("status")      ?? undefined
  const categoryIdParam  = searchParams.get("categoryId")   ?? undefined
  const dateFrom         = searchParams.get("dateFrom")     ?? undefined
  const dateTo           = searchParams.get("dateTo")       ?? undefined

  const canViewAll = canViewAllReimbursements(permissions)

  const where: Record<string, unknown> = { associationId }
  // A requester with no "reimbursements" area access only ever sees their own requests —
  // enforced here, not left to the client to ask for the right filter.
  where.requesterId = canViewAll ? (requesterIdParam || undefined) : userId
  if (statusParam) where.status = statusParam
  if (categoryIdParam) where.items = { some: { categoryId: categoryIdParam } }
  if (dateFrom || dateTo) {
    where.createdAt = {
      ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo   ? { lte: new Date(dateTo) }   : {}),
    }
  }

  const include = {
    requester: { select: { id: true, name: true } },
    project:   { select: { id: true, name: true } },
    event:     { select: { id: true, title: true } },
    items:     { select: { id: true, amount: true, categoryId: true } },
    reimbursement: { select: { id: true, date: true } },
  }
  const orderBy = { createdAt: "desc" as const }

  if (!searchParams.has("page")) {
    const data = await prisma.reimbursementRequest.findMany({ where, orderBy, include })
    return NextResponse.json(data)
  }

  const { page, limit, skip } = parsePagination(searchParams)
  const [data, total] = await Promise.all([
    prisma.reimbursementRequest.findMany({ where, orderBy, skip, take: limit, include }),
    prisma.reimbursementRequest.count({ where }),
  ])

  return NextResponse.json({ data, total, page, limit, totalPages: Math.ceil(total / limit) })
}, { module: "reimbursements" })

// requesterId always comes from the session, never the request body — any staff role can
// create a request for themselves, unconditional on the "reimbursements" area (see
// reimbursement-access.ts), so there is no permission check here beyond withAdminAuth's own
// staff-role + module gate.
export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body   = await req.json()
  const parsed = reimbursementRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { subject, comment, projectId, eventId } = parsed.data
  const request = await prisma.reimbursementRequest.create({
    data: {
      associationId,
      requesterId: userId,
      subject,
      comment:   comment   || null,
      projectId: projectId || null,
      eventId:   eventId   || null,
    },
  })

  return NextResponse.json(request, { status: 201 })
}, { module: "reimbursements" })
