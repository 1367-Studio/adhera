import { NextResponse } from "next/server"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import { z } from "zod"
import { sendEmail } from "@/lib/mail"
import { rsvpConfirmationEmail } from "@/lib/email"

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

  return NextResponse.json(participation)
}
