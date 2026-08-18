import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { rateLimit, requestIp } from "@/lib/rate-limit"

// Public ticket lookup by ticketToken — powers the /billet/[token] page linked from the
// QR code in confirmation emails. Access control is the token itself (160-bit, unique),
// same model as /api/public/cancel-ticket/[token].
export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params

  if (!(await rateLimit(`billet-info:${requestIp(req)}`, 30, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })
  }
  if (!/^[0-9a-f]{40}$/.test(token)) {
    return NextResponse.json({ error: "Billet introuvable" }, { status: 404 })
  }

  const participation = await prisma.participation.findUnique({
    where:   { ticketToken: token },
    include: {
      ticketType: { select: { label: true, price: true } },
      evenement: {
        select: {
          title: true, date: true, endDate: true, location: true,
          price: true,
          association: { select: { name: true } },
        },
      },
    },
  })
  if (!participation) return NextResponse.json({ error: "Billet introuvable" }, { status: 404 })

  // Same per-seat rule as everywhere else: the seat's own tier (once the event has tiers)
  // decides whether it required payment, else the event's flat price.
  const seatRequiresPayment = participation.ticketType
    ? Number(participation.ticketType.price) > 0
    : participation.evenement.price != null && Number(participation.evenement.price) > 0

  // A cancelled registration keeps its row but loses both ticketPaidAt and rsvp — see
  // /api/public/cancel-ticket and the charge.refunded webhook branch.
  const status = seatRequiresPayment
    ? (participation.ticketPaidAt ? "VALID" : participation.stripeSessionId ? "PENDING" : "CANCELLED")
    : (participation.rsvp === "CONFIRME" ? "VALID" : "CANCELLED")

  return NextResponse.json({
    eventTitle:      participation.evenement.title,
    eventDate:       participation.evenement.date,
    eventLocation:   participation.evenement.location,
    associationName: participation.evenement.association.name,
    firstName:       participation.firstName,
    lastName:        participation.lastName,
    ticketTypeLabel: participation.ticketType?.label ?? null,
    status,
    present:         participation.present,
  })
}
