import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import { pusherServer } from "@/lib/pusher-server"
import { sendEmail } from "@/lib/mail"
import { checkInReceiptEmail } from "@/lib/email"

type SessionUser = { id?: string; associationId?: string | null }

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  if (!u.associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { token } = await params

  const evenement = await prisma.evenement.findUnique({
    where:   { qrToken: token },
    include: { _count: { select: { participations: { where: { present: true } } } } },
  })
  if (!evenement) return NextResponse.json({ error: "QR Code invalide" }, { status: 404 })
  if (evenement.associationId !== u.associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const expired = evenement.qrExpiresAt ? evenement.qrExpiresAt < new Date() : false

  const membre = await prisma.membre.findFirst({
    where: { userId: u.id!, associationId: u.associationId, deletedAt: null },
  })

  const alreadyCheckedIn = membre
    ? !!(await prisma.participation.findUnique({
        where: { membreId_evenementId: { membreId: membre.id, evenementId: evenement.id } },
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
}

export async function POST(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  if (!u.associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { token } = await params

  const evenement = await prisma.evenement.findUnique({ where: { qrToken: token } })
  if (!evenement) return NextResponse.json({ error: "QR Code invalide" }, { status: 404 })
  if (evenement.associationId !== u.associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  if (evenement.qrExpiresAt && evenement.qrExpiresAt < new Date()) {
    return NextResponse.json({ error: "QR Code expiré" }, { status: 422 })
  }

  const membre = await prisma.membre.findFirst({
    where: { userId: u.id!, associationId: u.associationId, deletedAt: null },
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
    const associationId  = evenement.associationId
    Promise.resolve().then(async () => {
      const assoc = await prisma.association.findUnique({ where: { id: associationId }, select: { name: true } })
      if (assoc) await sendEmail(checkInReceiptEmail({
        firstName: memberFirst, email: memberEmail,
        associationName: assoc.name, eventTitle, eventDate,
      }))
    }).catch(() => {})
  }

  return NextResponse.json({ success: true, alreadyCheckedIn: wasAlreadyPresent, evenement: { title: evenement.title, date: evenement.date } })
}
