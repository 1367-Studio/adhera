import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { withSuperAdminAuth } from "@/lib/api-wrapper"
import { notifySupportMessage } from "@/lib/support-tickets"
import { ticketDetailInclude } from "@/app/api/backoffice/support-tickets/[id]/route"
import { SUPPORT_TICKET_BODY_MAX_LENGTH } from "@/lib/support-tickets-limits"

const messageSchema = z.object({
  body: z.string().trim().min(1, "Message requis").max(SUPPORT_TICKET_BODY_MAX_LENGTH),
})

export const POST = withSuperAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const existing = await prisma.supportTicket.findUnique({ where: { id } })
  if (!existing) return NextResponse.json({ error: "Ticket introuvable" }, { status: 404 })

  const parsed = messageSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const ticket = await prisma.$transaction(async (tx) => {
    await tx.supportTicketMessage.create({
      data: { ticketId: id, authorId: ctx.userId, body: parsed.data.body },
    })
    return tx.supportTicket.update({
      where: { id },
      data: {
        lastMessageAt:         new Date(),
        lastMessageAuthorRole: "SUPER_ADMIN",
        readByStaffAt:         new Date(),
      },
      include: ticketDetailInclude,
    })
  })

  await notifySupportMessage({ direction: "TO_ASSOCIATION", ticket, body: parsed.data.body })

  return NextResponse.json(ticket, { status: 201 })
})
