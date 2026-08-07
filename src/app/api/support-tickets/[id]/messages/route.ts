import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { notifySupportMessage } from "@/lib/support-tickets"
import { ticketDetailInclude } from "@/app/api/support-tickets/[id]/route"
import { SUPPORT_TICKET_BODY_MAX_LENGTH } from "@/lib/support-tickets-limits"

const ADMIN_ONLY = ["ADMIN"]

const messageSchema = z.object({
  body: z.string().trim().min(1, "Message requis").max(SUPPORT_TICKET_BODY_MAX_LENGTH),
})

export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const existing = await prisma.supportTicket.findFirst({ where: { id, associationId: ctx.associationId } })
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
        lastMessageAuthorRole: "ADMIN",
        // A closed ticket getting a new message from the association shouldn't silently
        // swallow it — reopens automatically rather than requiring a separate manual toggle.
        status:                "OUVERT",
        readByAssociationAt:   new Date(),
      },
      include: ticketDetailInclude,
    })
  })

  await notifySupportMessage({ direction: "TO_STAFF", ticket, body: parsed.data.body })

  return NextResponse.json(ticket, { status: 201 })
}, { roles: ADMIN_ONLY })
