import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

const ALLOWED_ROLES = ["ADMIN", "PRESIDENT", "SECRETAIRE"]
const PAGE_SIZE = 50

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const { searchParams } = new URL(req.url)
  const ruleId = searchParams.get("ruleId") ?? undefined
  const page   = Math.max(1, Number(searchParams.get("page") ?? "1"))
  const skip   = (page - 1) * PAGE_SIZE

  const where = {
    rule: { associationId },
    ...(ruleId ? { ruleId } : {}),
  }

  const [logs, total] = await Promise.all([
    prisma.automationLog.findMany({
      where,
      orderBy: { sentAt: "desc" },
      skip,
      take:    PAGE_SIZE,
      include: {
        rule:   { select: { name: true } },
        membre: { select: { firstName: true, lastName: true, email: true } },
      },
    }),
    prisma.automationLog.count({ where }),
  ])

  return NextResponse.json({ logs, total, page, pageSize: PAGE_SIZE })
}, { roles: ALLOWED_ROLES })
