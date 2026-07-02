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
    select: { present: true },
  })
  const wasAlreadyPresent = existing?.present === true

  await prisma.participation.upsert({
    where:  { membreId_evenementId: { membreId: membre.id, evenementId: evenement.id } },
    create: { membreId: membre.id, evenementId: evenement.id, present: true },
    update: { present: true },
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
