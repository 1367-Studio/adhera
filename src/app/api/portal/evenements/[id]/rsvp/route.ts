import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { z } from "zod"
import { sendEmail } from "@/lib/mail"
import { rsvpConfirmationEmail } from "@/lib/email"
import { fireEventRule } from "@/lib/fire-event-rule"
import { writeActivityLog } from "@/lib/activity-log"
import { withPortalAuth } from "@/lib/api-wrapper"

type Params = { id: string }

const bodySchema = z.object({
  rsvp:     z.enum(["CONFIRME", "PROVAVEL", "INCERTO", "ABSENT"]),
  quantity: z.number().int().min(1).optional().default(1),
})

export const PATCH = withPortalAuth<Params>(async (req, ctx, { id: evenementId }) => {
  const evenement = await prisma.evenement.findFirst({
    where: { id: evenementId, associationId: ctx.associationId },
  })
  if (!evenement) return NextResponse.json({ error: "Not found" }, { status: 404 })
  if (evenement.date < new Date()) return NextResponse.json({ error: "Événement déjà passé" }, { status: 422 })

  const body = await req.json()
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const membre = await prisma.membre.findUnique({
    where: { id: ctx.membreId! },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const existingParticipation = await prisma.participation.findUnique({
    where:  { membreId_evenementId: { membreId: membre.id, evenementId } },
    select: { rsvp: true, quantity: true },
  })
  const wasAlreadyConfirme = existingParticipation?.rsvp === "CONFIRME"

  if (parsed.data.rsvp === "CONFIRME" && evenement.capacity != null) {
    const { _sum } = await prisma.participation.aggregate({
      where: {
        evenementId,
        membreId: { not: membre.id },
        OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }],
      },
      _sum: { quantity: true },
    })
    if ((_sum.quantity ?? 0) + parsed.data.quantity > evenement.capacity)
      return NextResponse.json({ error: "Événement complet" }, { status: 422 })
  }

  const participation = await prisma.participation.upsert({
    where:  { membreId_evenementId: { membreId: membre.id, evenementId } },
    create: { membreId: membre.id, evenementId, rsvp: parsed.data.rsvp, rsvpAt: new Date(), quantity: parsed.data.quantity },
    update: { rsvp: parsed.data.rsvp, rsvpAt: new Date(), quantity: parsed.data.quantity },
  })

  // Re-verify capacity after upsert to handle concurrent RSVPs for the last spot(s)
  if (parsed.data.rsvp === "CONFIRME" && evenement.capacity != null) {
    const { _sum: postCheck } = await prisma.participation.aggregate({
      where: {
        evenementId,
        OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }],
      },
      _sum: { quantity: true },
    })
    if ((postCheck.quantity ?? 0) > evenement.capacity) {
      await prisma.participation.update({
        where: { id: participation.id },
        data:  {
          rsvp:     existingParticipation?.rsvp ?? null,
          quantity: existingParticipation?.quantity ?? 1,
        },
      })
      return NextResponse.json({ error: "Événement complet" }, { status: 422 })
    }
  }

  if (parsed.data.rsvp === "CONFIRME" && !wasAlreadyConfirme) {
    const assoc = await prisma.association.findUnique({
      where:  { id: ctx.associationId },
      select: { name: true, slug: true, modules: true },
    })
    if (assoc) {
      const portalUrl = `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/portal`
      void fireEventRule({
        triggerType:   "RSVP_CONFIRMED",
        associationId: ctx.associationId,
        association:   { name: assoc.name, slug: assoc.slug, modules: assoc.modules },
        membre:        { id: membre.id, firstName: membre.firstName, lastName: membre.lastName, email: membre.email, phone: membre.phone },
        evenement:     { id: evenementId, title: evenement.title, date: evenement.date, location: evenement.location },
      }).then(dispatched => {
        if (!dispatched && membre.email) {
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
      }).catch(() => {
        if (membre.email) {
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
      })
    }
  }

  if (existingParticipation?.rsvp !== parsed.data.rsvp) {
    await writeActivityLog({
      associationId: ctx.associationId,
      actorId:  ctx.userId,
      action:   "RSVP_UPDATED",
      entity:   "Participation",
      entityId: participation.id,
      label:    evenement.title,
      metadata: { rsvp: parsed.data.rsvp },
    })
  }

  return NextResponse.json(participation)
}, { module: "evenements" })
