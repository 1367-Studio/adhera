import { NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { Prisma } from "@prisma/client"
import { stripe, connectAccountChargesEnabled } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { z } from "zod"
import { APP_URL } from "@/lib/env"
import { writeActivityLog } from "@/lib/activity-log"
import { withPortalAuth } from "@/lib/api-wrapper"

const MAX_QUANTITY  = 10

type Params = { id: string }

const guestSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName:  z.string().min(1).max(80),
  email:     z.string().email().optional().or(z.literal("")),
  // Present only when the event has EvenementTicketType rows — see the ticketTypes lookup below.
  ticketTypeId: z.string().optional(),
})

const bodySchema = z.object({
  quantity: z.number().int().min(1).max(MAX_QUANTITY).optional().default(1),
  guests:   z.array(guestSchema).max(MAX_QUANTITY - 1).optional().default([]),
  // Self seat's tier, when the event has ticket types.
  ticketTypeId: z.string().optional(),
})

class EventFullError extends Error {}
class TicketTypeFullError extends Error {
  constructor(public label: string) { super() }
}

export const POST = withPortalAuth<Params>(async (req, ctx, { id: evenementId }) => {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  const { quantity, guests } = parsed.data

  const evenement = await prisma.evenement.findFirst({
    where:   { id: evenementId, associationId: ctx.associationId },
    include: { association: { select: { stripeConnectId: true, name: true, slug: true } }, ticketTypes: true },
  })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })
  if (evenement.date < new Date())
    return NextResponse.json({ error: "Événement déjà passé" }, { status: 422 })

  // Ticket types (when the admin defined any) replace the flat price entirely — a fully
  // free selection (every seat on a 0€ tier) is legitimate here and confirmed without
  // Stripe below, so this early guard only applies to the untiered flat-price case.
  const ticketTypes     = evenement.ticketTypes
  const hasTicketTypes  = ticketTypes.length > 0
  if (!hasTicketTypes && (evenement.price == null || Number(evenement.price) === 0))
    return NextResponse.json({ error: "Événement gratuit" }, { status: 422 })

  // Reject an unresolvable tier rather than silently falling back to the first one — a
  // stale/missing id here would otherwise mischarge the buyer with no error at all.
  function resolveTicketType(ticketTypeId: string | undefined) {
    return ticketTypes.find(tt => tt.id === ticketTypeId)
  }
  const selfTicketType = hasTicketTypes ? resolveTicketType(parsed.data.ticketTypeId) : undefined
  if (hasTicketTypes && !selfTicketType)
    return NextResponse.json({ error: "Tarif invalide" }, { status: 422 })

  const guestNames = Array.from({ length: quantity - 1 }, (_, i) => {
    const g = guests[i]
    return {
      firstName:  g?.firstName ?? "Invité",
      lastName:   g?.lastName  ?? String(i + 2),
      email:      g?.email,
      ticketType: hasTicketTypes ? resolveTicketType(g?.ticketTypeId) : undefined,
    }
  })
  if (hasTicketTypes && guestNames.some(g => !g.ticketType))
    return NextResponse.json({ error: "Tarif invalide" }, { status: 422 })

  const membre = await prisma.membre.findUnique({ where: { id: ctx.membreId! } })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const selfTicket = await prisma.participation.findFirst({
    where:  { membreId: membre.id, evenementId },
    select: { id: true, ticketPaidAt: true, stripeSessionId: true, orderId: true, ticketTypeId: true },
  })
  if (selfTicket?.ticketPaidAt)
    return NextResponse.json({ error: "Billet déjà acheté" }, { status: 422 })

  const orderId = selfTicket?.orderId ?? randomUUID()
  const existingCompanions = selfTicket
    ? await prisma.participation.findMany({
        where:   { orderId, membreId: null },
        orderBy: { createdAt: "asc" },
        select:  { id: true, ticketPaidAt: true, ticketTypeId: true },
      })
    : []

  // Whether an already-open Stripe session can still be reused depends on the seat count
  // AND, once the event has tiers, on every seat's chosen tier still matching what that
  // session was priced for — otherwise a reused link could charge stale amounts.
  const canReuseSession = existingCompanions.length === quantity - 1 && (
    !hasTicketTypes || (
      selfTicket?.ticketTypeId === selfTicketType?.id &&
      existingCompanions.every((c, i) => c.ticketTypeId === guestNames[i].ticketType?.id)
    )
  )

  // Every seat resolves to a tier price when the event has ticket types, else the flat
  // event price for all `quantity` seats — this is what actually gets charged, which can
  // differ from evenement.price once tiers exist. Computed up front so both the per-tier
  // capacity check below and the Stripe line items further down share the same list.
  const seatTicketTypes = hasTicketTypes ? [selfTicketType, ...guestNames.map(g => g.ticketType)] : []

  let ticketIds: string[]
  try {
    ticketIds = await prisma.$transaction(async (tx) => {
      if (evenement.capacity != null || ticketTypes.some(tt => tt.capacity != null)) {
        // Serialize concurrent checkouts for this event so the occupancy count below
        // can't race with another request also counting seats before either commits —
        // without this, two buyers going for the last spot at the same time could both pass.
        await tx.$queryRaw`SELECT id FROM "Evenement" WHERE id = ${evenementId} FOR UPDATE`
      }

      // Hold the slot(s) immediately so simultaneous requests can't oversell
      let selfId: string
      if (selfTicket) {
        // Backfill orderId if this row predates any order (e.g. an admin marked the
        // member present/paid before they ever RSVP'd) — otherwise the companions
        // created below end up on an orderId the member's own row doesn't share,
        // silently breaking group check-in/cancel for this booking.
        await tx.participation.update({ where: { id: selfTicket.id }, data: { rsvp: "CONFIRME", orderId, ticketTypeId: selfTicketType?.id ?? null } })
        selfId = selfTicket.id
      } else {
        const created = await tx.participation.create({
          data: {
            membreId: membre.id, evenementId, orderId, rsvp: "CONFIRME",
            firstName: membre.firstName, lastName: membre.lastName, email: membre.email,
            ticketTypeId: selfTicketType?.id ?? null,
          },
          select: { id: true },
        })
        selfId = created.id
      }

      const companionIds: string[] = []
      for (let i = 0; i < guestNames.length; i++) {
        const g = guestNames[i]
        if (existingCompanions[i]) {
          await tx.participation.update({
            where: { id: existingCompanions[i].id },
            data:  { firstName: g.firstName, lastName: g.lastName, email: g.email || null, rsvp: "CONFIRME", ticketTypeId: g.ticketType?.id ?? null },
          })
          companionIds.push(existingCompanions[i].id)
        } else {
          const created = await tx.participation.create({
            data:   { evenementId, orderId, firstName: g.firstName, lastName: g.lastName, email: g.email || null, rsvp: "CONFIRME", ticketTypeId: g.ticketType?.id ?? null },
            select: { id: true },
          })
          companionIds.push(created.id)
        }
      }
      if (existingCompanions.length > guestNames.length) {
        // A companion who's already been paid in cash at the door must never be
        // silently dropped just because the buyer later shrinks the party size.
        const removable = existingCompanions.slice(guestNames.length).filter(c => !c.ticketPaidAt)
        if (removable.length) {
          await tx.participation.deleteMany({ where: { id: { in: removable.map(c => c.id) } } })
        }
      }

      if (evenement.capacity != null) {
        const occupied = await tx.participation.count({
          where: { evenementId, OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }] },
        })
        if (occupied > evenement.capacity) throw new EventFullError()
      }

      // Same post-write count-and-check per tier actually used by this order — self-
      // correcting for resubmits/quantity changes since it counts what's in the DB after
      // the write, not a manual pre/post delta. One groupBy for every capped tier used
      // this request instead of a query per tier, to shorten the FOR UPDATE lock hold.
      const cappedTiers = [...new Set(seatTicketTypes.filter((t): t is NonNullable<typeof t> => t != null && t.capacity != null))]
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

      return [selfId, ...companionIds]
    })
  } catch (err) {
    if (err instanceof EventFullError) return NextResponse.json({ error: "Événement complet" }, { status: 422 })
    if (err instanceof TicketTypeFullError) return NextResponse.json({ error: `Le tarif « ${err.label} » est complet`, code: "TICKET_TYPE_FULL" }, { status: 422 })
    // Double-click / network retry racing another request for the same (membreId,
    // evenementId) self-ticket unique index — the other request already created it.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "Cet achat vient d'être enregistré — rechargez la page." }, { status: 409 })
    }
    throw err
  }

  const slug = evenement.association.slug
  const successUrl = `${APP_URL}/portal/${slug}/evenements?ticket=success&eid=${evenementId}`

  const totalCents = hasTicketTypes
    ? seatTicketTypes.reduce((sum, tt) => sum + Math.round(Number(tt?.price ?? 0) * 100), 0)
    : Math.round(Number(evenement.price) * 100) * quantity

  // A fully free selection (every chosen tier is 0€) needs no Stripe session at all —
  // confirm immediately, same as the free-RSVP flow, just reusing the "paid" success URL
  // so the frontend's existing redirect + confirmation toast handle it unchanged.
  if (totalCents === 0) {
    await prisma.participation.updateMany({ where: { id: { in: ticketIds } }, data: { ticketPaidAt: new Date() } })
    await writeActivityLog({
      associationId: ctx.associationId, actorId: ctx.userId, action: "TICKET_CHECKOUT_STARTED",
      entity: "Participation", entityId: ticketIds[0], label: evenement.title, metadata: { quantity, amount: 0 },
    })
    return NextResponse.json({ url: successUrl })
  }

  if (!evenement.association.stripeConnectId)
    return NextResponse.json({ error: "Paiement en ligne non disponible pour cette association" }, { status: 400 })
  if (!(await connectAccountChargesEnabled(evenement.association.stripeConnectId)))
    return NextResponse.json({ error: "Paiement en ligne non disponible pour cette association" }, { status: 400 })

  // Now that names/companions are persisted, decide whether the still-open session from
  // a previous attempt can be handed back as-is, or must be expired and replaced.
  if (selfTicket?.stripeSessionId) {
    const existingSession = await stripe.checkout.sessions.retrieve(selfTicket.stripeSessionId).catch(() => null)
    if (existingSession?.status === "open") {
      if (canReuseSession && existingSession.url) {
        return NextResponse.json({ url: existingSession.url })
      }
      await stripe.checkout.sessions.expire(existingSession.id).catch(() => {})
    }
  }

  // One line item per distinct tier actually chosen (grouped by tier id) when the event
  // has ticket types — including 0€ tiers mixed into a paid order as real zero-amount line
  // items, simpler than splitting the order into a free part and a paid part. Collapses to
  // exactly the old single line item for untiered events.
  const lineItems = hasTicketTypes
    ? (() => {
        const groups = new Map<string, { label: string; price: number; quantity: number }>()
        for (const tt of seatTicketTypes) {
          if (!tt) continue
          const g = groups.get(tt.id)
          if (g) g.quantity++
          else groups.set(tt.id, { label: tt.label, price: Number(tt.price), quantity: 1 })
        }
        return [...groups.values()].map(g => ({
          price_data: {
            currency:     "eur",
            unit_amount:  Math.round(g.price * 100),
            product_data: { name: `${evenement.association.name} — ${evenement.title} — ${g.label}` },
          },
          quantity: g.quantity,
        }))
      })()
    : [
        {
          price_data: {
            currency:     "eur",
            unit_amount:  Math.round(Number(evenement.price) * 100),
            product_data: { name: `${evenement.association.name} — ${evenement.title}` },
          },
          quantity,
        },
      ]

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: lineItems,
    payment_intent_data: {
      transfer_data: { destination: evenement.association.stripeConnectId },
      metadata:      { orderId, associationId: ctx.associationId },
    },
    metadata:    { orderId },
    success_url: successUrl,
    cancel_url:  `${APP_URL}/portal/${slug}/evenements?ticket=cancelled&eid=${evenementId}`,
    // The capacity slots are already held (rsvp: CONFIRME) before this session exists, and
    // only released back on `checkout.session.expired` — shorten Stripe's default 24h
    // window (the minimum Stripe allows) so an abandoned checkout doesn't hold spots all day.
    expires_at:  Math.floor(Date.now() / 1000) + 30 * 60,
  })

  if (!checkoutSession.url)
    return NextResponse.json({ error: "Impossible de créer la session de paiement" }, { status: 500 })

  await prisma.participation.updateMany({
    where: { id: { in: ticketIds } },
    data:  { stripeSessionId: checkoutSession.id },
  })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "TICKET_CHECKOUT_STARTED",
    entity:        "Participation",
    entityId:      ticketIds[0],
    label:         evenement.title,
    metadata:      { quantity, amount: totalCents / 100 },
  })

  return NextResponse.json({ url: checkoutSession.url })
}, { module: "evenements" })
