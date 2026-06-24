import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import type { SessionUser } from "@/lib/user-context"

const ALLOWED_ROLES = ["ADMIN", "PRESIDENT", "SECRETAIRE"]
const PAGE_SIZE = 50

export async function GET(req: Request) {
  const session = await auth()
  const u = session?.user as SessionUser | undefined
  if (!u?.associationId || !ALLOWED_ROLES.includes(u.role ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const ruleId = searchParams.get("ruleId") ?? undefined
  const page   = Math.max(1, Number(searchParams.get("page") ?? "1"))
  const skip   = (page - 1) * PAGE_SIZE

  const where = {
    rule: { associationId: u.associationId },
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
}
