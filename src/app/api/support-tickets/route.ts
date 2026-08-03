import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { notifySupportMessage, deriveTicketUnread } from "@/lib/support-tickets"
import { SUPPORT_TICKET_SUBJECT_MAX_LENGTH, SUPPORT_TICKET_BODY_MAX_LENGTH } from "@/lib/support-tickets-limits"

// Only the association's own ADMIN can see/open a ticket — not the other manager roles
// (PRESIDENT/TRESORIER/SECRETAIRE), confirmed with the client when this feature was scoped.
const ADMIN_ONLY = ["ADMIN"]

const createSchema = z.object({
  subject: z.string().trim().min(1, "Objet requis").max(SUPPORT_TICKET_SUBJECT_MAX_LENGTH),
  body:    z.string().trim().min(1, "Message requis").max(SUPPORT_TICKET_BODY_MAX_LENGTH),
})

export const GET = withAdminAuth(async (_req, ctx) => {
  const tickets = await prisma.supportTicket.findMany({
    where:   { associationId: ctx.associationId },
    orderBy: { lastMessageAt: "desc" },
  })
  return NextResponse.json(tickets.map(t => ({ ...t, unread: deriveTicketUnread(t, "ASSOCIATION") })))
}, { roles: ADMIN_ONLY })

export const POST = withAdminAuth(async (req, ctx) => {
  const body = await req.json()
  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const ticket = await prisma.$transaction(async (tx) => {
    const created = await tx.supportTicket.create({
      data: {
        associationId:         ctx.associationId,
        authorId:              ctx.userId,
        subject:               parsed.data.subject,
        lastMessageAuthorRole: "ADMIN",
        readByAssociationAt:   new Date(),
      },
    })
    await tx.supportTicketMessage.create({
      data: { ticketId: created.id, authorId: ctx.userId, body: parsed.data.body },
    })
    return tx.supportTicket.findUniqueOrThrow({
      where:   { id: created.id },
      include: {
        association: { select: { name: true } },
        author:      { select: { name: true, email: true } },
        messages:    { orderBy: { createdAt: "asc" } },
      },
    })
  })

  await notifySupportMessage({ direction: "TO_STAFF", ticket, body: parsed.data.body, isNewTicket: true })

  return NextResponse.json(ticket, { status: 201 })
}, { roles: ADMIN_ONLY })
