import { NextResponse } from "next/server"
import { prisma }       from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

const SOURCE = "SUPPORT_MESSAGE"
const DEFAULT_PAGE_SIZE = 20

export const GET = withAdminAuth(async (req, ctx) => {
  const { searchParams } = new URL(req.url)
  const page     = Math.max(1, Number(searchParams.get("page")     ?? 1)                    || 1)
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE))

  const where = { associationId: ctx.associationId, source: SOURCE }

  const [data, total] = await Promise.all([
    prisma.emailMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip:    (page - 1) * pageSize,
      take:    pageSize,
      select: {
        id: true, subject: true, html: true, status: true, to: true, sentAt: true, createdAt: true,
        user:   { select: { name: true, email: true, role: true } },
        membre: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.emailMessage.count({ where }),
  ])

  return NextResponse.json({
    data,
    total,
    page,
    totalPages: Math.ceil(total / pageSize),
    pageSize,
  })
})
