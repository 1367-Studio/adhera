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
    ? !!(await prisma.participation.findUnique({
        where: { membreId_evenementId: { membreId, evenementId: evenement.id } },
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

  const membre = await prisma.membre.findUnique({
    where:  { id: membreId! },
    select: { id: true, firstName: true, email: true },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const existing = await prisma.participation.findUnique({
    where:  { membreId_evenementId: { membreId: membre.id, evenementId: evenement.id } },
    select: { present: true, rsvp: true, ticketPaidAt: true, quantity: true, paidQuantity: true },
  })

  // Self check-in must not grant entry to someone who never reserved/paid for a spot —
  // require a paid ticket for paid events, or a confirmed RSVP for free ones.
  const isPaidEvent        = evenement.price != null && Number(evenement.price) > 0
  const hasValidReservation = isPaidEvent ? !!existing?.ticketPaidAt : existing?.rsvp === "CONFIRME"
  if (!hasValidReservation) {
    return NextResponse.json({
      error: isPaidEvent
        ? "Aucun billet payé pour cet événement."
        : "Confirmez votre présence (RSVP) avant de scanner ce QR code.",
    }, { status: 422 })
  }

  const wasAlreadyPresent = existing?.present === true

  if (!wasAlreadyPresent && evenement.capacity != null) {
    const presentParticipations = await prisma.participation.findMany({
      where:  { evenementId: evenement.id, present: true, membreId: { not: membre.id } },
      select: { quantity: true, paidQuantity: true },
    })
    const occupiedSlots =
      presentParticipations.reduce((sum, p) => sum + (p.paidQuantity ?? p.quantity), 0) +
      (existing?.paidQuantity ?? existing?.quantity ?? 1)
    if (occupiedSlots > evenement.capacity) {
      return NextResponse.json({ error: "Capacité maximale atteinte" }, { status: 422 })
    }
  }

  await prisma.participation.update({
    where: { membreId_evenementId: { membreId: membre.id, evenementId: evenement.id } },
    data:  { present: true },
  })

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
