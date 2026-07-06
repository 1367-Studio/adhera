import { NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { z } from "zod"
import { sendEmail } from "@/lib/mail"
import { rsvpConfirmationEmail } from "@/lib/email"
import { fireEventRule } from "@/lib/fire-event-rule"
import { writeActivityLog } from "@/lib/activity-log"
import { withPortalAuth } from "@/lib/api-wrapper"

type Params = { id: string }

const guestSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName:  z.string().min(1).max(80),
  email:     z.string().email().optional().or(z.literal("")),
})

const bodySchema = z.object({
  rsvp:     z.enum(["CONFIRME", "PROVAVEL", "INCERTO", "ABSENT"]),
  quantity: z.number().int().min(1).max(10).optional().default(1),
  guests:   z.array(guestSchema).max(9).optional().default([]),
})

class EventFullError extends Error {}

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

  const selfTicket = await prisma.participation.findFirst({
    where:  { membreId: membre.id, evenementId },
    select: { id: true, rsvp: true, orderId: true },
  })
  const wasAlreadyConfirme = selfTicket?.rsvp === "CONFIRME"
  const orderId            = selfTicket?.orderId ?? randomUUID()

  const { rsvp, quantity, guests } = parsed.data
  // Pad/truncate the supplied guest names to the number of companion seats requested,
  // filling any gap with an editable placeholder rather than rejecting the request.
  const guestNames = Array.from({ length: quantity - 1 }, (_, i) => guests[i] ?? { firstName: "Invité", lastName: String(i + 2), email: undefined })

  let participationId: string
  try {
    participationId = await prisma.$transaction(async (tx) => {
      if (rsvp === "CONFIRME" && evenement.capacity != null) {
        // Serialize concurrent RSVPs for this event so the occupancy count below can't
        // race with another request also counting seats before either commits — without
        // this, two people confirming for the last spot at the same time could both pass.
        await tx.$queryRaw`SELECT id FROM "Evenement" WHERE id = ${evenementId} FOR UPDATE`
      }

      let selfId: string
      if (selfTicket) {
        // Backfill orderId if this row predates any order (e.g. an admin marked the
        // member present/paid before they ever RSVP'd) — otherwise the companions
        // created below end up on an orderId the member's own row doesn't share,
        // silently breaking group check-in/cancel for this booking.
        await tx.participation.update({ where: { id: selfTicket.id }, data: { rsvp, rsvpAt: new Date(), orderId } })
        selfId = selfTicket.id
      } else {
        const created = await tx.participation.create({
          data: {
            membreId: membre.id, evenementId, orderId,
            firstName: membre.firstName, lastName: membre.lastName, email: membre.email,
            rsvp, rsvpAt: new Date(),
          },
          select: { id: true },
        })
        selfId = created.id
      }

      // Reconcile the companion rows already on this order with the requested guest list:
      // update names in place for the overlap, create the extra ones, drop the surplus.
      const existingCompanions = await tx.participation.findMany({
        where:   { orderId, membreId: null },
        orderBy: { createdAt: "asc" },
        select:  { id: true, ticketPaidAt: true },
      })

      for (let i = 0; i < guestNames.length; i++) {
        const g = guestNames[i]
        if (existingCompanions[i]) {
          await tx.participation.update({
            where: { id: existingCompanions[i].id },
            data:  { firstName: g.firstName, lastName: g.lastName, email: g.email || null, rsvp, rsvpAt: new Date() },
          })
        } else {
          await tx.participation.create({
            data: { evenementId, orderId, firstName: g.firstName, lastName: g.lastName, email: g.email || null, rsvp, rsvpAt: new Date() },
          })
        }
      }
      if (existingCompanions.length > guestNames.length) {
        // A companion who's already been paid in cash at the door must never be
        // silently dropped just because the member later shrinks the party size.
        const removable = existingCompanions.slice(guestNames.length).filter(c => !c.ticketPaidAt)
        if (removable.length) {
          await tx.participation.deleteMany({ where: { id: { in: removable.map(c => c.id) } } })
        }
      }

      if (rsvp === "CONFIRME" && evenement.capacity != null) {
        const occupied = await tx.participation.count({
          where: { evenementId, OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }] },
        })
        if (occupied > evenement.capacity) throw new EventFullError()
      }

      return selfId
    })
  } catch (err) {
    if (err instanceof EventFullError) return NextResponse.json({ error: "Événement complet" }, { status: 422 })
    // Double-click / network retry racing another request for the same (membreId,
    // evenementId) self-ticket unique index — the other request already created it.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "Cette réservation vient d'être enregistrée — rechargez la page." }, { status: 409 })
    }
    throw err
  }

  if (rsvp === "CONFIRME" && !wasAlreadyConfirme) {
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

  if (selfTicket?.rsvp !== rsvp) {
    await writeActivityLog({
      associationId: ctx.associationId,
      actorId:  ctx.userId,
      action:   "RSVP_UPDATED",
      entity:   "Participation",
      entityId: participationId,
      label:    evenement.title,
      metadata: { rsvp, quantity },
    })
  }

  return NextResponse.json({ id: participationId, rsvp, quantity })
}, { module: "evenements" })
