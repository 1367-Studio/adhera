import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { pusherServer } from "@/lib/pusher-server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { writeActivityLog } from "@/lib/activity-log"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

const bodySchema = z.object({
  // Raw decoded QR content — either the bare ticketToken or the /billet/[token] URL the
  // emailed QR encodes; the token is extracted here so every scanner client stays dumb.
  token: z.string().min(1).max(500),
})

// Organizer-side ticket validation: the door scanner (dashboard → présences → scanner)
// posts each decoded QR here; a VALID result marks that one seat present. Unlike the
// attendee self check-in (/api/portal/check-in/[token]) there is no time-window guard —
// the organizer decides when their door opens.
export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id: evenementId }) => {
  const { associationId, userId } = ctx

  const parsed = bodySchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  const evenement = await prisma.evenement.findFirst({ where: { id: evenementId, associationId } })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })

  const token = parsed.data.token.match(/[0-9a-f]{40}/i)?.[0]?.toLowerCase()
  const participation = token
    ? await prisma.participation.findUnique({
        where:   { ticketToken: token },
        include: {
          ticketType: { select: { label: true, price: true } },
          evenement:  { select: { id: true, title: true, associationId: true } },
        },
      })
    : null
  // An unknown token and another association's ticket are deliberately the same answer —
  // nothing about a foreign tenant's data should be inferable from a scan.
  if (!participation || participation.evenement.associationId !== associationId) {
    return NextResponse.json({ status: "INVALID" })
  }

  const attendee = {
    firstName:       participation.firstName,
    lastName:        participation.lastName,
    ticketTypeLabel: participation.ticketType?.label ?? null,
  }

  if (participation.evenementId !== evenementId) {
    return NextResponse.json({ status: "WRONG_EVENT", attendee, eventTitle: participation.evenement.title })
  }

  // Same per-seat rule as the rest of the app: the seat's own tier (once the event has
  // tiers) decides whether it required payment, else the event's flat price. A cancelled
  // registration keeps its row but loses ticketPaidAt/rsvp (cancel-ticket route, webhook).
  const seatRequiresPayment = participation.ticketType
    ? Number(participation.ticketType.price) > 0
    : evenement.price != null && Number(evenement.price) > 0
  if (seatRequiresPayment && !participation.ticketPaidAt) {
    return NextResponse.json({ status: participation.stripeSessionId ? "NOT_PAID" : "CANCELLED", attendee })
  }
  if (!seatRequiresPayment && participation.rsvp !== "CONFIRME" && !participation.ticketPaidAt) {
    return NextResponse.json({ status: "CANCELLED", attendee })
  }

  if (participation.present) {
    return NextResponse.json({ status: "ALREADY", attendee })
  }

  // Mirrors the manual present-toggle's capacity guard (participations route POST).
  if (evenement.capacity != null) {
    const occupied = await prisma.participation.count({
      where: { evenementId, present: true, id: { not: participation.id } },
    })
    if (occupied + 1 > evenement.capacity) {
      return NextResponse.json({ status: "FULL", attendee })
    }
  }

  await prisma.participation.update({ where: { id: participation.id }, data: { present: true } })

  await writeActivityLog({
    associationId,
    actorId:  userId,
    action:   "PRESENCE_MARKED",
    entity:   "Participation",
    entityId: participation.id,
    label:    evenement.title,
    metadata: { present: true, memberName: `${participation.firstName} ${participation.lastName}`, via: "qr_ticket_scan" },
  })

  // Same channel/event the presences list already listens to for live updates.
  pusherServer.trigger(`event-${evenementId}`, "check-in", { participationId: participation.id }).catch(() => {})

  return NextResponse.json({ status: "VALID", attendee })
}, { roles: MANAGERS })
