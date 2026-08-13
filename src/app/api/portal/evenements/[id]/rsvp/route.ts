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
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { APP_URL } from "@/lib/env"

type Params = { id: string }

const guestSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName:  z.string().min(1).max(80),
  email:     z.string().email().optional().or(z.literal("")),
  // Present only when the event has EvenementTicketType rows and rsvp is CONFIRME.
  ticketTypeId: z.string().optional(),
})

const bodySchema = z.object({
  rsvp:     z.enum(["CONFIRME", "PROVAVEL", "INCERTO", "ABSENT"]),
  quantity: z.number().int().min(1).max(10).optional().default(1),
  guests:   z.array(guestSchema).max(9).optional().default([]),
  // Self seat's tier, when the event has ticket types.
  ticketTypeId: z.string().optional(),
})

class EventFullError extends Error {}
class TicketTypeFullError extends Error {
  constructor(public label: string) { super() }
}

export const PATCH = withPortalAuth<Params>(async (req, ctx, { id: evenementId }) => {
  const evenement = await prisma.evenement.findFirst({
    where:   { id: evenementId, associationId: ctx.associationId },
    include: { ticketTypes: true },
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
  const guestNames = Array.from({ length: quantity - 1 }, (_, i) => guests[i] ?? { firstName: "Invité", lastName: String(i + 2), email: undefined, ticketTypeId: undefined })

  // Ticket types (when the event has any) must be validated up front for a real
  // reservation — reject rather than silently default, same reasoning as the Stripe
  // checkout route: a stale/missing tier here would otherwise get cash-marked at the
  // wrong price later with no one noticing.
  const hasTicketTypes = evenement.ticketTypes.length > 0
  if (rsvp === "CONFIRME" && hasTicketTypes) {
    const validIds = new Set(evenement.ticketTypes.map(tt => tt.id))
    if (!parsed.data.ticketTypeId || !validIds.has(parsed.data.ticketTypeId) || guestNames.some(g => !g.ticketTypeId || !validIds.has(g.ticketTypeId))) {
      return NextResponse.json({ error: "Tarif invalide" }, { status: 422 })
    }
  }

  let participationId: string
  try {
    participationId = await prisma.$transaction(async (tx) => {
      if (rsvp === "CONFIRME" && (evenement.capacity != null || evenement.ticketTypes.some(tt => tt.capacity != null))) {
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
        await tx.participation.update({ where: { id: selfTicket.id }, data: { rsvp, rsvpAt: new Date(), orderId, ...(hasTicketTypes && rsvp === "CONFIRME" ? { ticketTypeId: parsed.data.ticketTypeId } : {}) } })
        selfId = selfTicket.id
      } else {
        const created = await tx.participation.create({
          data: {
            membreId: membre.id, evenementId, orderId,
            firstName: membre.firstName, lastName: membre.lastName, email: membre.email,
            rsvp, rsvpAt: new Date(),
            ticketTypeId: hasTicketTypes && rsvp === "CONFIRME" ? parsed.data.ticketTypeId : null,
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
        const guestTicketTypeId = hasTicketTypes && rsvp === "CONFIRME" ? (g.ticketTypeId ?? null) : null
        if (existingCompanions[i]) {
          await tx.participation.update({
            where: { id: existingCompanions[i].id },
            data:  { firstName: g.firstName, lastName: g.lastName, email: g.email || null, rsvp, rsvpAt: new Date(), ticketTypeId: guestTicketTypeId },
          })
        } else {
          await tx.participation.create({
            data: { evenementId, orderId, firstName: g.firstName, lastName: g.lastName, email: g.email || null, rsvp, rsvpAt: new Date(), ticketTypeId: guestTicketTypeId },
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

      // Same post-write count-and-check per tier actually used by this reservation — one
      // groupBy for every capped tier used this request instead of a query per tier, to
      // shorten the FOR UPDATE lock hold.
      if (rsvp === "CONFIRME" && hasTicketTypes) {
        const usedTierIds = new Set([parsed.data.ticketTypeId, ...guestNames.map(g => g.ticketTypeId)])
        const cappedTiers = [...usedTierIds]
          .map(ttId => evenement.ticketTypes.find(t => t.id === ttId))
          .filter((tt): tt is NonNullable<typeof tt> => tt != null && tt.capacity != null)
        if (cappedTiers.length) {
          const occupancy = await tx.participation.groupBy({
            by:     ["ticketTypeId"],
            where:  { evenementId, ticketTypeId: { in: cappedTiers.map(tt => tt.id) }, OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }] },
            _count: { _all: true },
          })
          const occupiedMap = new Map(occupancy.map(o => [o.ticketTypeId, o._count._all]))
          for (const tt of cappedTiers) {
            if ((occupiedMap.get(tt.id) ?? 0) > tt.capacity!) throw new TicketTypeFullError(tt.label)
          }
        }
      }

      return selfId
    })
  } catch (err) {
    if (err instanceof EventFullError) return NextResponse.json({ error: "Événement complet" }, { status: 422 })
    if (err instanceof TicketTypeFullError) return NextResponse.json({ error: `Le tarif « ${err.label} » est complet`, code: "TICKET_TYPE_FULL" }, { status: 422 })
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
      select: { name: true, slug: true, modules: true, plan: true, customBrandingEnabled: true, logoUrl: true },
    })
    if (assoc) {
      const portalUrl = `${APP_URL}/portal/${assoc.slug}/evenements`
      const branding   = resolveDocumentBranding(assoc)
      void fireEventRule({
        triggerType:   "RSVP_CONFIRMED",
        associationId: ctx.associationId,
        association:   { name: assoc.name, slug: assoc.slug, modules: assoc.modules, plan: assoc.plan, customBrandingEnabled: assoc.customBrandingEnabled, logoUrl: assoc.logoUrl },
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
            branding,
          }), { associationId: ctx.associationId, membreId: membre.id, source: "TRANSACTION", sourceId: evenementId }).catch(() => {})
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
            branding,
          }), { associationId: ctx.associationId, membreId: membre.id, source: "TRANSACTION", sourceId: evenementId }).catch(() => {})
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
