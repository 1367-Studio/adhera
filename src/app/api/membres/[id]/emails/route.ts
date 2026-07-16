import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"

const DEFAULT_PAGE_SIZE = 20

export const GET = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId } = ctx

  const membre = await prisma.membre.findFirst({ where: { id, associationId }, select: { id: true } })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const { searchParams } = new URL(req.url)
  const page     = Math.max(1, Number(searchParams.get("page")     ?? 1)                    || 1)
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE))

  const where = { associationId, membreId: id }

  const [data, total] = await Promise.all([
    prisma.emailMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip:    (page - 1) * pageSize,
      take:    pageSize,
      select: {
        id: true, subject: true, source: true, status: true, errorMessage: true, to: true,
        sentAt: true, deliveredAt: true, openedAt: true, clickedAt: true, bouncedAt: true, complainedAt: true, createdAt: true,
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
