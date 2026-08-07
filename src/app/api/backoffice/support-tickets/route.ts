import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withSuperAdminAuth } from "@/lib/api-wrapper"
import { deriveTicketUnread } from "@/lib/support-tickets"

// The global inbox — every association's tickets, not scoped to one. Optional ?status=
// filters at the DB level; "unread" is computed per-row in JS (see deriveTicketUnread) since
// it depends on comparing two columns of the same row, which Prisma's query API can't express
// without raw SQL — not worth it at the scale this table will ever reach (one row per support
// conversation across all associations, not per member/event).
export const GET = withSuperAdminAuth(async (req) => {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get("status")

  const tickets = await prisma.supportTicket.findMany({
    where:   status === "OUVERT" || status === "FERME" ? { status } : {},
    include: { association: { select: { name: true, slug: true } } },
    orderBy: { lastMessageAt: "desc" },
  })
  return NextResponse.json(tickets.map(t => ({ ...t, unread: deriveTicketUnread(t, "STAFF") })))
})
