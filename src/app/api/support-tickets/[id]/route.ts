import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

const ADMIN_ONLY = ["ADMIN"]

// Shared with ./messages/route.ts so both endpoints return the exact same shape the thread UI
// expects, regardless of which one a given request hit.
export const ticketDetailInclude = {
  association: { select: { name: true } },
  author:      { select: { name: true, email: true } },
  messages: {
    orderBy: { createdAt: "asc" as const },
    include: { author: { select: { name: true, role: true } } },
  },
}

const patchSchema = z.object({
  read:   z.literal(true).optional(),
  // Only closing is allowed from the association side — reopening happens implicitly by
  // sending a new message (see ./messages/route.ts), not a manual toggle here.
  status: z.literal("FERME").optional(),
})

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const ticket = await prisma.supportTicket.findFirst({
    where:   { id, associationId: ctx.associationId },
    include: ticketDetailInclude,
  })
  if (!ticket) return NextResponse.json({ error: "Ticket introuvable" }, { status: 404 })
  return NextResponse.json(ticket)
}, { roles: ADMIN_ONLY })

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const existing = await prisma.supportTicket.findFirst({ where: { id, associationId: ctx.associationId } })
  if (!existing) return NextResponse.json({ error: "Ticket introuvable" }, { status: 404 })

  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const ticket = await prisma.supportTicket.update({
    where: { id },
    data: {
      ...(parsed.data.read   ? { readByAssociationAt: new Date() } : {}),
      ...(parsed.data.status ? { status: parsed.data.status }      : {}),
    },
    include: ticketDetailInclude,
  })
  return NextResponse.json(ticket)
}, { roles: ADMIN_ONLY })
