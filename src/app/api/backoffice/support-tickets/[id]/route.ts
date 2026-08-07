import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { withSuperAdminAuth } from "@/lib/api-wrapper"

// Shared with ./messages/route.ts — same reasoning as the tenant side's equivalent constant.
export const ticketDetailInclude = {
  association: { select: { name: true, slug: true } },
  author:      { select: { name: true, email: true } },
  messages: {
    orderBy: { createdAt: "asc" as const },
    include: { author: { select: { name: true, role: true } } },
  },
}

const patchSchema = z.object({
  read:   z.literal(true).optional(),
  // Staff can toggle either direction, unlike the association side (which can only close —
  // see src/app/api/support-tickets/[id]/route.ts).
  status: z.enum(["OUVERT", "FERME"]).optional(),
})

export const GET = withSuperAdminAuth<{ id: string }>(async (_req, _ctx, { id }) => {
  const ticket = await prisma.supportTicket.findUnique({ where: { id }, include: ticketDetailInclude })
  if (!ticket) return NextResponse.json({ error: "Ticket introuvable" }, { status: 404 })
  return NextResponse.json(ticket)
})

export const PATCH = withSuperAdminAuth<{ id: string }>(async (req, _ctx, { id }) => {
  const existing = await prisma.supportTicket.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Ticket introuvable" }, { status: 404 })

  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const ticket = await prisma.supportTicket.update({
    where: { id },
    data: {
      ...(parsed.data.read   ? { readByStaffAt: new Date() } : {}),
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
    },
    include: ticketDetailInclude,
  })
  return NextResponse.json(ticket)
})
