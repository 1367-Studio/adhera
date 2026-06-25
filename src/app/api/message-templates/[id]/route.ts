import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import type { SessionUser } from "@/lib/user-context"
import { writeActivityLog } from "@/lib/activity-log"

const ALLOWED_ROLES = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

const schema = z.object({
  name:    z.string().min(1).max(100).optional(),
  subject: z.string().min(1).max(200).optional(),
  body:    z.string().min(1).optional(),
})

async function resolve(id: string, associationId: string) {
  return prisma.messageTemplate.findFirst({ where: { id, associationId } })
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const u = session?.user as SessionUser | undefined
  if (!u?.associationId || !ALLOWED_ROLES.includes(u.role ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const existing = await resolve(id, u.associationId)
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const updated = await prisma.messageTemplate.update({ where: { id }, data: parsed.data })
  await writeActivityLog({ associationId: u.associationId, actorId: u.id, action: "TEMPLATE_UPDATED", entity: "MessageTemplate", entityId: id, label: updated.name })
  return NextResponse.json(updated)
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  const u = session?.user as SessionUser | undefined
  if (!u?.associationId || !ALLOWED_ROLES.includes(u.role ?? "")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params
  const existing = await resolve(id, u.associationId)
  if (!existing) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const usedByRules = await prisma.automationRule.count({ where: { templateId: id } })
  if (usedByRules > 0) {
    return NextResponse.json({ error: "Ce modèle est utilisé par des règles actives. Supprimez-les d'abord." }, { status: 409 })
  }

  await prisma.messageTemplate.delete({ where: { id } })
  await writeActivityLog({ associationId: u.associationId, actorId: u.id, action: "TEMPLATE_DELETED", entity: "MessageTemplate", entityId: id, label: existing.name })
  return new NextResponse(null, { status: 204 })
}
