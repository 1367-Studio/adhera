import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { pusherServer } from "@/lib/pusher-server"
import { sendEmail } from "@/lib/mail"
import { checkInReceiptEmail } from "@/lib/email"
import { withPortalAuth } from "@/lib/api-wrapper"

export const GET = withPortalAuth<{ token: string }>(async (_req, ctx, { token }) => {
  const { associationId, membreId } = ctx

  const evenement = await prisma.evenement.findUnique({
    where:   { qrToken: token },
    include: { _count: { select: { participations: { where: { present: true } } } } },
  })
  if (!evenement) return NextResponse.json({ error: "QR Code invalide" }, { status: 404 })
  if (evenement.associationId !== associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const expired = evenement.qrExpiresAt ? evenement.qrExpiresAt < new Date() : false

  const alreadyCheckedIn = membreId
    ? !!(await prisma.participation.findFirst({
        where: { membreId, evenementId: evenement.id },
        select: { present: true },
      }).then(p => p?.present))
    : false

  return NextResponse.json({
    title:            evenement.title,
    date:             evenement.date,
    expired,
    alreadyCheckedIn,
    totalPresent:     evenement._count.participations,
  })
}, { requireMembre: false })

export const POST = withPortalAuth<{ token: string }>(async (_req, ctx, { token }) => {
  const { associationId, membreId } = ctx

  const evenement = await prisma.evenement.findUnique({ where: { qrToken: token } })
  if (!evenement) return NextResponse.json({ error: "QR Code invalide" }, { status: 404 })
  if (evenement.associationId !== associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  if (evenement.qrExpiresAt && evenement.qrExpiresAt < new Date()) {
    return NextResponse.json({ error: "QR Code expiré" }, { status: 422 })
  }

  // The QR's own 24h expiry only bounds how long ago it was generated, not whether the
  // event is actually happening now — an admin could generate it well before the event, or
  // it could still be valid well after. Reject check-in outside a grace window around the
  // event itself so a still-active link can't be used for a remote or off-day check-in.
  const now         = new Date()
  const eventStart  = evenement.date
  const eventEnd    = evenement.endDate ?? new Date(eventStart.getTime() + 24 * 3_600_000)
  const graceBefore = 3 * 3_600_000
  const graceAfter  = 6 * 3_600_000
  if (now < new Date(eventStart.getTime() - graceBefore) || now > new Date(eventEnd.getTime() + graceAfter)) {
    return NextResponse.json({ error: "Le check-in n'est pas ouvert pour cet événement en ce moment." }, { status: 422 })
  }

  const membre = await prisma.membre.findUnique({
    where:  { id: membreId! },
    select: { id: true, firstName: true, email: true },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const existing = await prisma.participation.findFirst({
    where:  { membreId: membre.id, evenementId: evenement.id },
    select: { id: true, present: true, rsvp: true, ticketPaidAt: true, orderId: true },
  })

  // Self check-in must not grant entry to someone who never reserved/paid for a spot —
  // require a paid ticket for paid events, or a confirmed RSVP for free ones.
  const isPaidEvent        = evenement.price != null && Number(evenement.price) > 0
  const hasValidReservation = isPaidEvent ? !!existing?.ticketPaidAt : existing?.rsvp === "CONFIRME"
  if (!existing || !hasValidReservation) {
    return NextResponse.json({
      error: isPaidEvent
        ? "Aucun billet payé pour cet événement."
        : "Confirmez votre présence (RSVP) avant de scanner ce QR code.",
    }, { status: 422 })
  }

  // Checking in marks the whole order present at once — the member and any named
  // companions they brought, since they all arrive together.
  const groupWhere = existing.orderId ? { orderId: existing.orderId } : { id: existing.id }
  const wasAlreadyPresent = existing.present === true

  if (!wasAlreadyPresent && evenement.capacity != null) {
    const [otherPresentCount, partySize] = await Promise.all([
      prisma.participation.count({ where: { evenementId: evenement.id, present: true, NOT: groupWhere } }),
      prisma.participation.count({ where: groupWhere }),
    ])
    if (otherPresentCount + partySize > evenement.capacity) {
      return NextResponse.json({ error: "Capacité maximale atteinte" }, { status: 422 })
    }
  }

  await prisma.participation.updateMany({ where: groupWhere, data: { present: true } })

  pusherServer.trigger(`event-${evenement.id}`, "check-in", { membreId: membre.id }).catch(() => {})

  if (!wasAlreadyPresent && membre.email) {
    const memberEmail    = membre.email
    const memberFirst    = membre.firstName
    const eventTitle     = evenement.title
    const eventDate      = evenement.date
    const associationIdForEmail = evenement.associationId
    Promise.resolve().then(async () => {
      const assoc = await prisma.association.findUnique({ where: { id: associationIdForEmail }, select: { name: true } })
      if (assoc) await sendEmail(checkInReceiptEmail({
        firstName: memberFirst, email: memberEmail,
        associationName: assoc.name, eventTitle, eventDate,
      }))
    }).catch(() => {})
  }

  return NextResponse.json({ success: true, alreadyCheckedIn: wasAlreadyPresent, evenement: { title: evenement.title, date: evenement.date } })
})
