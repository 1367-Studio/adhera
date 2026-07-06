import { NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { stripe } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { z } from "zod"
import { APP_URL } from "@/lib/env"
import { writeActivityLog } from "@/lib/activity-log"
import { withPortalAuth } from "@/lib/api-wrapper"

const PLATFORM_FEE = 0.015
const MAX_QUANTITY  = 10

type Params = { id: string }

const guestSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName:  z.string().min(1).max(80),
  email:     z.string().email().optional().or(z.literal("")),
})

const bodySchema = z.object({
  quantity: z.number().int().min(1).max(MAX_QUANTITY).optional().default(1),
  guests:   z.array(guestSchema).max(MAX_QUANTITY - 1).optional().default([]),
})

class EventFullError extends Error {}

export const POST = withPortalAuth<Params>(async (req, ctx, { id: evenementId }) => {
  const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  const { quantity, guests } = parsed.data

  const evenement = await prisma.evenement.findFirst({
    where:   { id: evenementId, associationId: ctx.associationId },
    include: { association: { select: { stripeConnectId: true, name: true, slug: true } } },
  })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })
  if (evenement.date < new Date())
    return NextResponse.json({ error: "Événement déjà passé" }, { status: 422 })
  if (evenement.price == null || Number(evenement.price) === 0)
    return NextResponse.json({ error: "Événement gratuit" }, { status: 422 })
  if (!evenement.association.stripeConnectId)
    return NextResponse.json({ error: "Paiement en ligne non disponible pour cette association" }, { status: 400 })

  const connectAccount = await stripe.accounts.retrieve(evenement.association.stripeConnectId)
  if (!connectAccount.charges_enabled)
    return NextResponse.json({ error: "Paiement en ligne non disponible pour cette association" }, { status: 400 })

  const membre = await prisma.membre.findUnique({ where: { id: ctx.membreId! } })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const selfTicket = await prisma.participation.findFirst({
    where:  { membreId: membre.id, evenementId },
    select: { id: true, ticketPaidAt: true, stripeSessionId: true, orderId: true },
  })
  if (selfTicket?.ticketPaidAt)
    return NextResponse.json({ error: "Billet déjà acheté" }, { status: 422 })

  const orderId = selfTicket?.orderId ?? randomUUID()
  const existingCompanions = selfTicket
    ? await prisma.participation.findMany({
        where:   { orderId, membreId: null },
        orderBy: { createdAt: "asc" },
        select:  { id: true, ticketPaidAt: true },
      })
    : []

  // Whether an already-open Stripe session can still be reused depends only on the seat
  // count matching (its line item quantity is locked in) — resolved after the names below
  // are persisted, so reusing the link never leaves stale names sitting in the database.
  const canReuseSession = existingCompanions.length === quantity - 1

  const guestNames = Array.from({ length: quantity - 1 }, (_, i) => guests[i] ?? { firstName: "Invité", lastName: String(i + 2), email: undefined })

  let ticketIds: string[]
  try {
    ticketIds = await prisma.$transaction(async (tx) => {
      if (evenement.capacity != null) {
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
        await tx.participation.update({ where: { id: selfTicket.id }, data: { rsvp: "CONFIRME", orderId } })
        selfId = selfTicket.id
      } else {
        const created = await tx.participation.create({
          data: {
            membreId: membre.id, evenementId, orderId, rsvp: "CONFIRME",
            firstName: membre.firstName, lastName: membre.lastName, email: membre.email,
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
            data:  { firstName: g.firstName, lastName: g.lastName, email: g.email || null, rsvp: "CONFIRME" },
          })
          companionIds.push(existingCompanions[i].id)
        } else {
          const created = await tx.participation.create({
            data:   { evenementId, orderId, firstName: g.firstName, lastName: g.lastName, email: g.email || null, rsvp: "CONFIRME" },
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

      return [selfId, ...companionIds]
    })
  } catch (err) {
    if (err instanceof EventFullError) return NextResponse.json({ error: "Événement complet" }, { status: 422 })
    throw err
  }

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

  const amountCents    = Math.round(Number(evenement.price) * 100)
  const totalCents     = amountCents * quantity
  const applicationFee = Math.round(totalCents * PLATFORM_FEE)
  const slug           = evenement.association.slug

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency:     "eur",
          unit_amount:  amountCents,
          product_data: { name: `${evenement.association.name} — ${evenement.title}` },
        },
        quantity,
      },
    ],
    payment_intent_data: {
      application_fee_amount: applicationFee,
      transfer_data:          { destination: evenement.association.stripeConnectId },
      metadata:               { orderId, associationId: ctx.associationId },
    },
    metadata:    { orderId },
    success_url: `${APP_URL}/portal/${slug}/evenements?ticket=success&eid=${evenementId}`,
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
    metadata:      { quantity, amount: Number(evenement.price) * quantity },
  })

  return NextResponse.json({ url: checkoutSession.url })
}, { module: "evenements" })
