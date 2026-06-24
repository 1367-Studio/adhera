import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import type { SessionUser } from "@/lib/user-context"

const ALLOWED_ROLES = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

const schema = z.object({
  name:    z.string().min(1).max(100),
  subject: z.string().min(1).max(200),
  body:    z.string().min(1),
})

export async function GET() {
  const session = await auth()
  const u = session?.user as SessionUser | undefined
  if (!u?.associationId || !ALLOWED_ROLES.includes(u.role ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const templates = await prisma.messageTemplate.findMany({
    where:   { associationId: u.associationId },
    orderBy: { createdAt: "desc" },
    select:  { id: true, name: true, subject: true, body: true, createdAt: true, updatedAt: true, _count: { select: { rules: true } } },
  })

  return NextResponse.json(templates)
}

export async function POST(req: Request) {
  const session = await auth()
  const u = session?.user as SessionUser | undefined
  if (!u?.associationId || !ALLOWED_ROLES.includes(u.role ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const template = await prisma.messageTemplate.create({
    data: { ...parsed.data, associationId: u.associationId },
  })

  return NextResponse.json(template, { status: 201 })
}
