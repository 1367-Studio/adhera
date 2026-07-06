import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"

type Params = { id: string }

// Lists every seat in the caller's own order (their ticket + any named companions) so
// the portal can offer cancelling a single seat instead of only the whole booking.
export const GET = withPortalAuth<Params>(async (_req, ctx, { id: evenementId }) => {
  const selfTicket = await prisma.participation.findFirst({
    where:  { membreId: ctx.membreId!, evenementId },
    select: { id: true, orderId: true },
  })
  if (!selfTicket) return NextResponse.json([])

  const groupWhere = selfTicket.orderId ? { orderId: selfTicket.orderId } : { id: selfTicket.id }
  const tickets = await prisma.participation.findMany({
    where:   { evenementId, ...groupWhere },
    orderBy: [{ membreId: "desc" }, { createdAt: "asc" }],
    select:  { id: true, firstName: true, lastName: true, membreId: true, present: true, ticketPaidAt: true, rsvp: true },
  })

  return NextResponse.json(tickets.map(t => ({
    id:           t.id,
    firstName:    t.firstName,
    lastName:     t.lastName,
    isSelf:       t.id === selfTicket.id,
    present:      t.present,
    ticketPaidAt: t.ticketPaidAt,
    rsvp:         t.rsvp,
  })))
}, { module: "evenements" })
