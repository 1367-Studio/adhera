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
    prisma.smsMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip:    (page - 1) * pageSize,
      take:    pageSize,
      // body included directly (unlike EmailMessage.html) — SMS bodies are capped at 1600
      // chars and already plain text, nowhere near the cost that justifies a lazy fetch.
      select: {
        id: true, body: true, to: true, source: true, status: true, errorMessage: true,
        sentAt: true, deliveredAt: true, failedAt: true, createdAt: true,
      },
    }),
    prisma.smsMessage.count({ where }),
  ])

  return NextResponse.json({
    data,
    total,
    page,
    totalPages: Math.ceil(total / pageSize),
    pageSize,
  })
}, { module: "sms" })
