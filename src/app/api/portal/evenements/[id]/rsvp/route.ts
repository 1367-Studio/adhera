import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import { z } from "zod"
import { sendEmail } from "@/lib/mail"
import { rsvpConfirmationEmail } from "@/lib/email"
import { writeActivityLog } from "@/lib/activity-log"

type SessionUser = { id?: string; associationId?: string | null }

const bodySchema = z.object({
  rsvp: z.enum(["CONFIRME", "PROVAVEL", "INCERTO", "ABSENT"]),
})

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const u = session.user as SessionUser
  if (!u.associationId) return NextResponse.json({ error: "Forbidden" }, { status: 403 })

  const { id: evenementId } = await params

  const evenement = await prisma.evenement.findFirst({
    where: { id: evenementId, associationId: u.associationId },
  })
  if (!evenement) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (evenement.date < new Date()) return NextResponse.json({ error: "Événement déjà passé" }, { status: 422 })

  const body = await req.json()
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const membre = await prisma.membre.findFirst({
    where: { userId: u.id!, associationId: u.associationId, deletedAt: null },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const existingParticipation = await prisma.participation.findUnique({
    where:  { membreId_evenementId: { membreId: membre.id, evenementId } },
    select: { rsvp: true },
  })
  const wasAlreadyConfirme = existingParticipation?.rsvp === "CONFIRME"

  if (
    parsed.data.rsvp === "CONFIRME" &&
    !wasAlreadyConfirme &&
    evenement.price != null &&
    Number(evenement.price) > 0 &&
    evenement.capacity != null
  ) {
    const { _sum } = await prisma.participation.aggregate({
      where: {
        evenementId,
        membreId: { not: membre.id },
        OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }],
      },
      _sum: { quantity: true },
    })
    if ((_sum.quantity ?? 0) + 1 > evenement.capacity)
      return NextResponse.json({ error: "Événement complet" }, { status: 422 })
  }

  const participation = await prisma.participation.upsert({
    where:  { membreId_evenementId: { membreId: membre.id, evenementId } },
    create: { membreId: membre.id, evenementId, rsvp: parsed.data.rsvp, rsvpAt: new Date() },
    update: { rsvp: parsed.data.rsvp, rsvpAt: new Date() },
  })

  if (parsed.data.rsvp === "CONFIRME" && !wasAlreadyConfirme && membre.email) {
    const assoc = await prisma.association.findUnique({ where: { id: u.associationId! }, select: { name: true } })
    if (assoc) {
      const portalUrl = `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/portal`
      sendEmail(rsvpConfirmationEmail({
        firstName:       membre.firstName,
        email:           membre.email,
        associationName: assoc.name,
        eventTitle:      evenement.title,
        eventDate:       evenement.date,
        eventLocation:   evenement.location,
        portalUrl,
      })).catch(() => {})
    }
  }

  if (existingParticipation?.rsvp !== parsed.data.rsvp) {
    await writeActivityLog({
      associationId: u.associationId!,
      actorId:  u.id,
      action:   "RSVP_UPDATED",
      entity:   "Participation",
      entityId: participation.id,
      label:    evenement.title,
      metadata: { rsvp: parsed.data.rsvp },
    })
  }

  return NextResponse.json(participation)
}
