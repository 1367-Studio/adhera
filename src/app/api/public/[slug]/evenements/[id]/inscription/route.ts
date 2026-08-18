import { NextResponse } from "next/server"
import { randomUUID, randomBytes } from "crypto"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"
import { stripe, connectAccountChargesEnabled } from "@/lib/stripe"
import { APP_URL } from "@/lib/env"
import { rateLimit, requestIp } from "@/lib/rate-limit"
import { writeActivityLog } from "@/lib/activity-log"
import { sendEmail } from "@/lib/mail"
import { rsvpConfirmationEmail } from "@/lib/email"
import { resolveDocumentBranding } from "@/lib/plan-limits"

const MAX_NUMBER_FIELD_VALUE = 999_999
const MAX_QUANTITY = 10

const attendeeSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName:  z.string().trim().min(1).max(80),
  email:     z.string().trim().email().max(200),
  // Present only when the event has EvenementTicketType rows — see the ticketTypes lookup below.
  ticketTypeId: z.string().optional(),
  phone:        z.string().trim().max(30).optional().or(z.literal("")),
  address:      z.string().trim().max(300).optional().or(z.literal("")),
  // Each ticket belongs to a different person, so custom-field answers (e.g. shirt size)
  // are asked and stored per attendee, not once for the whole order.
  answers:      z.record(z.string(), z.string().max(500)).optional().default({}),
})

const baseSchema = z.object({
  // One entry per ticket — each ticket belongs to a different person, even within a
  // single order. Every submission (including a single ticket) goes through this array.
  attendees: z.array(attendeeSchema).min(1).max(MAX_QUANTITY),
  // Honeypot — a real visitor never sees or fills this field (hidden off-screen in the
  // public form); a non-empty value means a bot filled every input it could find.
  website:   z.string().optional().or(z.literal("")),
})

class EventFullError extends Error {}
class TicketTypeFullError extends Error {
  constructor(public label: string) { super() }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params

  if (!(await rateLimit(`evenement-inscription:${requestIp(req)}`, 5, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })
  }

  const body   = await req.json().catch(() => null)
  const parsed = baseSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  // Pretend success without touching the DB or Stripe — a bot that filled the honeypot
  // gets a response indistinguishable from a real registration, so it has no signal to
  // adjust and try again.
  if (parsed.data.website) return NextResponse.json({ ok: true })

  const { attendees } = parsed.data

  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: {
      id: true, name: true, slug: true, sitePublished: true, modules: true, stripeConnectId: true,
      plan: true, customBrandingEnabled: true, logoUrl: true,
    },
  })
  if (!assoc || !assoc.sitePublished) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const mods = parseModules(assoc.modules)
  if (!mods.site || !mods.evenements) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const evenement = await prisma.evenement.findFirst({
    where:   { id, associationId: assoc.id },
    include: { customFields: true, ticketTypes: true },
  })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })
  if (evenement.date < new Date())
    return NextResponse.json({ error: "Événement déjà passé" }, { status: 422 })

  // Custom fields are admin-defined per event, so their validation can't be a static
  // zod schema — required/type checked here against what's currently configured. Each
  // attendee answers their own copy (e.g. shirt size), so every attendee is checked.
  const knownFieldIds = new Set(evenement.customFields.map(f => f.id))
  for (const a of attendees) {
    for (const field of evenement.customFields) {
      const value = a.answers[field.id]
      if (field.required && (value == null || value.trim() === "")) {
        return NextResponse.json({ error: `Le champ « ${field.label} » est requis.` }, { status: 422 })
      }
      if (field.type === "NUMBER" && value && value.trim() !== "") {
        const n = Number(value)
        if (!Number.isInteger(n) || n < 0 || n > MAX_NUMBER_FIELD_VALUE) {
          return NextResponse.json({ error: `Le champ « ${field.label} » doit être un nombre entier valide.` }, { status: 422 })
        }
      }
    }
  }

  // Ticket types (when the admin defined any) replace the flat price entirely — every
  // attendee must have picked one, and its price (not evenement.price) drives everything
  // below for that seat.
  const hasTicketTypes = evenement.ticketTypes.length > 0
  const flatPrice      = evenement.price != null ? Number(evenement.price) : 0
  const resolveTicketType = (ticketTypeId: string | undefined) =>
    evenement.ticketTypes.find(tt => tt.id === ticketTypeId) ?? null
  const resolvedAttendees = attendees.map(a => ({
    ...a,
    email:        a.email.toLowerCase(),
    ticketType:   hasTicketTypes ? resolveTicketType(a.ticketTypeId) : null,
    cleanAnswers: Object.fromEntries(Object.entries(a.answers).filter(([k]) => knownFieldIds.has(k))),
  }))
  if (hasTicketTypes && resolvedAttendees.some(a => !a.ticketType)) {
    return NextResponse.json({ error: "Tarif invalide", code: "INVALID_TICKET_TYPE" }, { status: 422 })
  }
  // Two seats in the same order sharing an email would otherwise silently create two
  // Participation rows with the same address — harmless by itself, but it makes the dedup
  // logic below ambiguous about which row is "the" registration for that email.
  if (new Set(resolvedAttendees.map(a => a.email)).size !== resolvedAttendees.length) {
    return NextResponse.json({ error: "Chaque billet doit utiliser une adresse e-mail différente.", code: "DUPLICATE_EMAIL" }, { status: 422 })
  }
  const seatPrice = (a: (typeof resolvedAttendees)[number]): number =>
    a.ticketType ? Number(a.ticketType.price) : flatPrice
  const isPaid = resolvedAttendees.some(a => seatPrice(a) > 0)
  if (isPaid && (!assoc.stripeConnectId || !(await connectAccountChargesEnabled(assoc.stripeConnectId)))) {
    return NextResponse.json({ error: "Paiement en ligne non disponible pour cette association" }, { status: 400 })
  }

  // ---- Single-ticket order: same resume/reuse behavior as before tickets could be ----
  // ---- grouped — an abandoned checkout can be picked back up from the same email.  ----
  if (resolvedAttendees.length === 1) {
    const attendee = resolvedAttendees[0]
    const { firstName, lastName, email, ticketType, phone, address, cleanAnswers } = attendee

    // Dedup by email — only meaningful for the resume/reuse logic below.
    const existing = await prisma.participation.findFirst({
      where:  { evenementId: id, email: { equals: email, mode: "insensitive" } },
      select: { id: true, ticketPaidAt: true, stripeSessionId: true, orderId: true, rsvp: true, ticketTypeId: true, ticketToken: true },
    })

    // Whether the EXISTING row itself was ever actually going to require payment — keyed off
    // its own recorded tier/price at the time, not today's (possibly different) selection.
    const existingTicketType = existing?.ticketTypeId ? evenement.ticketTypes.find(tt => tt.id === existing.ticketTypeId) : null
    const existingWasPaid    = existingTicketType
      ? Number(existingTicketType.price) > 0
      : evenement.price != null && Number(evenement.price) > 0

    // A cancelled registration (via /annulation) leaves the row in place with both
    // ticketPaidAt and rsvp cleared — it must NOT count as "already registered" here.
    if (existing && (existing.ticketPaidAt || (existing.rsvp === "CONFIRME" && !existing.stripeSessionId && !existingWasPaid))) {
      return NextResponse.json({ error: "Vous êtes déjà inscrit(e) à cet événement avec cette adresse e-mail." }, { status: 409 })
    }

    const orderId     = existing?.orderId ?? randomUUID()
    const cancelToken = randomBytes(20).toString("hex")
    // Reuse the existing row's ticket token when re-registering — the QR already emailed
    // for it must keep working instead of being silently invalidated by a new token.
    const ticketToken = existing?.ticketToken ?? randomBytes(20).toString("hex")

    let participationId: string
    try {
      participationId = await prisma.$transaction(async (tx) => {
        if (evenement.capacity != null || evenement.ticketTypes.some(tt => tt.capacity != null)) {
          await tx.$queryRaw`SELECT id FROM "Evenement" WHERE id = ${id} FOR UPDATE`
        }

        let pid: string
        if (existing) {
          await tx.participation.update({
            where: { id: existing.id },
            data:  { firstName, lastName, phone: phone || null, address: address || null, answers: cleanAnswers, rsvp: "CONFIRME", rsvpAt: new Date(), ticketTypeId: ticketType?.id ?? null, ticketToken },
          })
          pid = existing.id
        } else {
          const created = await tx.participation.create({
            data: {
              evenementId: id,
              orderId,
              firstName, lastName, email,
              phone:   phone || null,
              address: address || null,
              answers: cleanAnswers,
              rsvp:    "CONFIRME",
              rsvpAt:  new Date(),
              cancelToken,
              ticketToken,
              ticketTypeId: ticketType?.id ?? null,
            },
            select: { id: true },
          })
          pid = created.id
        }

        if (evenement.capacity != null) {
          const occupied = await tx.participation.count({
            where: { evenementId: id, OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }] },
          })
          if (occupied > evenement.capacity) throw new EventFullError()
        }

        if (ticketType?.capacity != null) {
          const occupiedTier = await tx.participation.count({
            where: { evenementId: id, ticketTypeId: ticketType.id, OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }] },
          })
          if (occupiedTier > ticketType.capacity) throw new TicketTypeFullError(ticketType.label)
        }

        return pid
      })
    } catch (err) {
      if (err instanceof EventFullError) return NextResponse.json({ error: "Événement complet" }, { status: 422 })
      if (err instanceof TicketTypeFullError) return NextResponse.json({ error: `Le tarif « ${err.label} » est complet`, code: "TICKET_TYPE_FULL" }, { status: 422 })
      throw err
    }

    await writeActivityLog({
      associationId: assoc.id, action: "PARTICIPATION_PUBLIC_CREATED", entity: "Participation", entityId: participationId,
      label: `${firstName} ${lastName} — ${evenement.title}`,
    })

    if (!isPaid) {
      await sendEmail(rsvpConfirmationEmail({
        firstName, email,
        associationName: assoc.name,
        eventTitle:      evenement.title,
        eventDate:       evenement.date,
        eventLocation:   evenement.location,
        portalUrl:       `${APP_URL}/${slug}/evenements/${id}`,
        cancelUrl:       `${APP_URL}/annulation/${cancelToken}`,
        ticketQr: {
          imageUrl: `${APP_URL}/api/public/billet/${ticketToken}/qr`,
          pageUrl:  `${APP_URL}/billet/${ticketToken}`,
        },
        branding:        resolveDocumentBranding(assoc),
      }), { associationId: assoc.id, source: "PUBLIC_EVENT_INSCRIPTION", sourceId: participationId }).catch(() => {})
      return NextResponse.json({ ok: true })
    }

    if (existing?.stripeSessionId) {
      const existingSession = await stripe.checkout.sessions.retrieve(existing.stripeSessionId).catch(() => null)
      if (existingSession?.status === "open" && existingSession.url) {
        return NextResponse.json({ url: existingSession.url })
      }
    }

    const amountCents = Math.round(seatPrice(attendee) * 100)
    const productName = ticketType ? `${assoc.name} — ${evenement.title} — ${ticketType.label}` : `${assoc.name} — ${evenement.title}`

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price_data: { currency: "eur", unit_amount: amountCents, product_data: { name: productName } }, quantity: 1 }],
      payment_intent_data: { transfer_data: { destination: assoc.stripeConnectId! }, metadata: { orderId, associationId: assoc.id } },
      metadata:       { orderId },
      customer_email: email,
      success_url:    `${APP_URL}/${slug}/evenements/${id}?ticket=success`,
      cancel_url:     `${APP_URL}/${slug}/evenements/${id}?ticket=cancelled`,
      expires_at:     Math.floor(Date.now() / 1000) + 30 * 60,
    })

    if (!checkoutSession.url) {
      if (!existing) await prisma.participation.delete({ where: { id: participationId } }).catch(() => {})
      return NextResponse.json({ error: "Impossible de créer la session de paiement" }, { status: 500 })
    }

    await prisma.participation.update({ where: { id: participationId }, data: { stripeSessionId: checkoutSession.id } })

    return NextResponse.json({ url: checkoutSession.url })
  }

  // ---- Multi-ticket order: one Participation per attendee, sharing one orderId. ----
  // No resume/reuse here — every submission creates fresh rows; an abandoned checkout
  // self-heals in 30min when its Stripe session expires (handled by the webhook, same
  // as everywhere else this pattern is used).
  const existingByEmail = await prisma.participation.findMany({
    where:  { evenementId: id, email: { in: resolvedAttendees.map(a => a.email), mode: "insensitive" } },
    select: { id: true, email: true, ticketPaidAt: true, rsvp: true, stripeSessionId: true, ticketTypeId: true },
  })
  const isBlocked = (existing: (typeof existingByEmail)[number]): boolean => {
    const existingTicketType = existing.ticketTypeId ? evenement.ticketTypes.find(tt => tt.id === existing.ticketTypeId) : null
    const existingWasPaid    = existingTicketType
      ? Number(existingTicketType.price) > 0
      : evenement.price != null && Number(evenement.price) > 0
    // A cancelled registration (via /annulation) leaves the row in place with both
    // ticketPaidAt and rsvp cleared — it must NOT count as "already registered" here.
    return !!(existing.ticketPaidAt || (existing.rsvp === "CONFIRME" && !existing.stripeSessionId && !existingWasPaid))
  }

  // A mixed submission ("me + a new friend" when "me" already has a ticket from a
  // previous visit) shouldn't fail the whole order over one no-op attendee — only the
  // genuinely new ones get a seat here, and the response tells the buyer who was skipped.
  const skippedEmails: string[] = []
  const newAttendees = resolvedAttendees.filter(a => {
    const existing = existingByEmail.find(e => e.email?.toLowerCase() === a.email)
    if (!existing || !isBlocked(existing)) return true
    skippedEmails.push(a.email)
    return false
  })
  if (newAttendees.length === 0) {
    return NextResponse.json({ error: `${skippedEmails[0]} est déjà inscrit(e) à cet événement.`, code: "ALREADY_REGISTERED", email: skippedEmails[0] }, { status: 409 })
  }

  // Release any abandoned (unpaid, still-held) rows among the attendees being (re)created
  // below — otherwise the old hold would sit dangling for up to 30min, double-counting
  // capacity, and its still-open Stripe link would remain completable in parallel with
  // this new order (risking a duplicate charge for the same person).
  const staleHolds = newAttendees
    .map(a => existingByEmail.find(e => e.email?.toLowerCase() === a.email))
    .filter((e): e is NonNullable<typeof e> => !!e && !e.ticketPaidAt && e.rsvp === "CONFIRME")
  if (staleHolds.length) {
    await Promise.all(staleHolds.map(h => h.stripeSessionId
      ? stripe.checkout.sessions.expire(h.stripeSessionId).catch(() => {})
      : Promise.resolve()))
    await prisma.participation.updateMany({
      where: { id: { in: staleHolds.map(h => h.id) } },
      data:  { rsvp: null, stripeSessionId: null },
    })
  }

  const orderId      = randomUUID()
  const cancelTokens = newAttendees.map(() => randomBytes(20).toString("hex"))
  const ticketTokens = newAttendees.map(() => randomBytes(20).toString("hex"))

  let participationIds: string[]
  try {
    participationIds = await prisma.$transaction(async (tx) => {
      if (evenement.capacity != null || evenement.ticketTypes.some(tt => tt.capacity != null)) {
        // Serialize concurrent registrations for this event — without it, two orders
        // racing for the last spot(s) could both pass the occupancy check below.
        await tx.$queryRaw`SELECT id FROM "Evenement" WHERE id = ${id} FOR UPDATE`
      }

      // Sequential, not Promise.all — a transaction runs on a single connection, so
      // concurrent queries on `tx` aren't safe (same pattern as the portal checkout route).
      const ids: string[] = []
      for (let i = 0; i < newAttendees.length; i++) {
        const a = newAttendees[i]
        const created = await tx.participation.create({
          data: {
            evenementId: id,
            orderId,
            firstName: a.firstName,
            lastName:  a.lastName,
            email:     a.email,
            phone:     a.phone || null,
            address:   a.address || null,
            answers:   a.cleanAnswers,
            rsvp:      "CONFIRME",
            rsvpAt:  new Date(),
            cancelToken:  cancelTokens[i],
            ticketToken:  ticketTokens[i],
            ticketTypeId: a.ticketType?.id ?? null,
          },
          select: { id: true },
        })
        ids.push(created.id)
      }

      if (evenement.capacity != null) {
        const occupied = await tx.participation.count({
          where: { evenementId: id, OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }] },
        })
        if (occupied > evenement.capacity) throw new EventFullError()
      }

      // Per-tier occupancy for every distinct capped tier actually used in this order.
      const cappedTiers = [...new Set(
        newAttendees.map(a => a.ticketType).filter((t): t is NonNullable<typeof t> => t != null && t.capacity != null),
      )]
      if (cappedTiers.length) {
        const occupancy = await tx.participation.groupBy({
          by:     ["ticketTypeId"],
          where:  { evenementId: id, ticketTypeId: { in: cappedTiers.map(tt => tt.id) }, OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }] },
          _count: { _all: true },
        })
        const occupiedMap = new Map(occupancy.map(o => [o.ticketTypeId, o._count._all]))
        for (const tt of cappedTiers) {
          if ((occupiedMap.get(tt.id) ?? 0) > tt.capacity!) throw new TicketTypeFullError(tt.label)
        }
      }

      return ids
    })
  } catch (err) {
    if (err instanceof EventFullError) return NextResponse.json({ error: "Événement complet" }, { status: 422 })
    if (err instanceof TicketTypeFullError) return NextResponse.json({ error: `Le tarif « ${err.label} » est complet`, code: "TICKET_TYPE_FULL" }, { status: 422 })
    throw err
  }

  await Promise.all(newAttendees.map((a, i) => writeActivityLog({
    associationId: assoc.id, action: "PARTICIPATION_PUBLIC_CREATED", entity: "Participation", entityId: participationIds[i],
    label: `${a.firstName} ${a.lastName} — ${evenement.title}`,
  })))

  if (!isPaid) {
    await Promise.all(newAttendees.map((a, i) => sendEmail(rsvpConfirmationEmail({
      firstName: a.firstName,
      email:     a.email,
      associationName: assoc.name,
      eventTitle:      evenement.title,
      eventDate:       evenement.date,
      eventLocation:   evenement.location,
      portalUrl:       `${APP_URL}/${slug}/evenements/${id}`,
      cancelUrl:       `${APP_URL}/annulation/${cancelTokens[i]}`,
      ticketQr: {
        imageUrl: `${APP_URL}/api/public/billet/${ticketTokens[i]}/qr`,
        pageUrl:  `${APP_URL}/billet/${ticketTokens[i]}`,
      },
      branding:        resolveDocumentBranding(assoc),
    }), { associationId: assoc.id, source: "PUBLIC_EVENT_INSCRIPTION", sourceId: participationIds[i] }).catch(() => {})))
    return NextResponse.json({ ok: true, skippedEmails })
  }

  // One line item per distinct tier actually chosen (grouped by tier id) — including 0€
  // tiers mixed into an otherwise-paid order as real zero-amount line items. Collapses to
  // one line item per attendee (still grouped) for events with no ticket types.
  const groups = new Map<string, { label: string; price: number; quantity: number }>()
  for (const a of newAttendees) {
    const key   = a.ticketType?.id ?? "flat"
    const label = a.ticketType?.label ?? evenement.title
    const g = groups.get(key)
    if (g) g.quantity++
    else groups.set(key, { label, price: seatPrice(a), quantity: 1 })
  }
  const lineItems = [...groups.values()].map(g => ({
    price_data: {
      currency:     "eur",
      unit_amount:  Math.round(g.price * 100),
      product_data: { name: hasTicketTypes ? `${assoc.name} — ${evenement.title} — ${g.label}` : `${assoc.name} — ${evenement.title}` },
    },
    quantity: g.quantity,
  }))

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: lineItems,
    payment_intent_data: {
      transfer_data: { destination: assoc.stripeConnectId! },
      metadata:      { orderId, associationId: assoc.id },
    },
    metadata:       { orderId },
    customer_email: newAttendees[0].email,
    // Carries the skipped count through the Stripe round-trip so the confirmation page can
    // still tell the buyer about it — the JSON response's own `skippedEmails` never reaches
    // the browser here since it redirects straight to Stripe instead of reading this reply.
    success_url:    `${APP_URL}/${slug}/evenements/${id}?ticket=success${skippedEmails.length ? `&skipped=${skippedEmails.length}` : ""}`,
    cancel_url:     `${APP_URL}/${slug}/evenements/${id}?ticket=cancelled`,
    expires_at:     Math.floor(Date.now() / 1000) + 30 * 60,
  })

  if (!checkoutSession.url) {
    await prisma.participation.deleteMany({ where: { id: { in: participationIds } } }).catch(() => {})
    return NextResponse.json({ error: "Impossible de créer la session de paiement" }, { status: 500 })
  }

  await prisma.participation.updateMany({
    where: { id: { in: participationIds } },
    data:  { stripeSessionId: checkoutSession.id },
  })

  return NextResponse.json({ url: checkoutSession.url, skippedEmails })
}
