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

const baseSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName:  z.string().trim().min(1).max(80),
  email:     z.string().trim().email().max(200).optional().or(z.literal("")),
  phone:     z.string().trim().max(30).optional().or(z.literal("")),
  address:   z.string().trim().max(300).optional().or(z.literal("")),
  answers:   z.record(z.string(), z.string().max(500)).optional().default({}),
  // Honeypot — a real visitor never sees or fills this field (hidden off-screen in the
  // public form); a non-empty value means a bot filled every input it could find.
  website:   z.string().optional().or(z.literal("")),
  // Present only when the event has EvenementTicketType rows — see the ticketTypes lookup below.
  ticketTypeId: z.string().optional(),
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

  const { firstName, lastName, phone, address, answers } = parsed.data
  const email = parsed.data.email ? parsed.data.email.toLowerCase() : ""

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
  // zod schema — required/type checked here against what's currently configured.
  for (const field of evenement.customFields) {
    const value = answers[field.id]
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
  const knownFieldIds = new Set(evenement.customFields.map(f => f.id))
  const cleanAnswers  = Object.fromEntries(Object.entries(answers).filter(([k]) => knownFieldIds.has(k)))

  // Ticket types (when the admin defined any) replace the flat price entirely — the visitor
  // must have picked one, and its price (not evenement.price) drives everything below.
  let ticketType: (typeof evenement.ticketTypes)[number] | null = null
  if (evenement.ticketTypes.length > 0) {
    ticketType = evenement.ticketTypes.find(tt => tt.id === parsed.data.ticketTypeId) ?? null
    if (!ticketType) return NextResponse.json({ error: "Tarif invalide", code: "INVALID_TICKET_TYPE" }, { status: 422 })
  }
  const isPaid = ticketType ? Number(ticketType.price) > 0 : evenement.price != null && Number(evenement.price) > 0
  if (isPaid) {
    if (!email) return NextResponse.json({ error: "L'e-mail est requis pour un événement payant." }, { status: 422 })
    if (!assoc.stripeConnectId || !(await connectAccountChargesEnabled(assoc.stripeConnectId)))
      return NextResponse.json({ error: "Paiement en ligne non disponible pour cette association" }, { status: 400 })
  }

  // Dedup by email — only meaningful when an email was given (free events don't require
  // one, so two anonymous free entries can't be told apart; that's an inherent limit of
  // not forcing an account/email on every visitor, not something this check can close).
  const existing = email
    ? await prisma.participation.findFirst({
        where:  { evenementId: id, email: { equals: email, mode: "insensitive" } },
        select: { id: true, ticketPaidAt: true, stripeSessionId: true, orderId: true, rsvp: true, ticketTypeId: true },
      })
    : null

  // Whether the EXISTING row itself was ever actually going to require payment — keyed off
  // its own recorded tier/price at the time, not today's (possibly different) selection.
  // Ticket types make "isPaid" a per-submission thing rather than a fixed event property,
  // so re-deriving this from the *new* selection (as before tiers existed) would wrongly
  // let switching tiers dodge the dedup check, or wrongly block a switch that should be
  // allowed — see the two cases below.
  const existingTicketType = existing?.ticketTypeId ? evenement.ticketTypes.find(tt => tt.id === existing.ticketTypeId) : null
  const existingWasPaid    = existingTicketType
    ? Number(existingTicketType.price) > 0
    : evenement.price != null && Number(evenement.price) > 0

  // A cancelled registration (via /annulation) leaves the row in place with both
  // ticketPaidAt and rsvp cleared — it must NOT count as "already registered" here, or
  // cancelling a free RSVP would permanently lock that email out of ever re-registering.
  // An abandoned-but-never-cancelled paid checkout still has rsvp CONFIRME (the seat hold)
  // with ticketPaidAt null and a stripeSessionId once a session was created — that case
  // still falls through to the resume/reuse path below (or, if they're now picking a
  // different tier, is allowed to proceed and replace the stale hold) rather than being
  // treated as a done deal.
  if (existing && (existing.ticketPaidAt || (existing.rsvp === "CONFIRME" && !existing.stripeSessionId && !existingWasPaid))) {
    return NextResponse.json({ error: "Vous êtes déjà inscrit(e) à cet événement avec cette adresse e-mail." }, { status: 409 })
  }

  // existing here (if any) is either a paid event's abandoned/in-progress checkout or a
  // previously-cancelled registration being resumed — reuse that same row instead of
  // minting a second one that would double-count capacity.
  const orderId    = existing?.orderId ?? randomUUID()
  // Only used when actually creating a new row below — an existing/reused row already
  // has its own token from when it was first created, untouched by this update.
  const cancelToken = randomBytes(20).toString("hex")

  let participationId: string
  try {
    participationId = await prisma.$transaction(async (tx) => {
      if (evenement.capacity != null || evenement.ticketTypes.some(tt => tt.capacity != null)) {
        // Serialize concurrent registrations for this event, same lock used by the
        // portal ticket checkout — without it, two public visitors racing for the last
        // spot (or the same visitor re-registering after a cancellation right as it
        // fills up) could both pass the occupancy check below.
        await tx.$queryRaw`SELECT id FROM "Evenement" WHERE id = ${id} FOR UPDATE`
      }

      let pid: string
      if (existing) {
        await tx.participation.update({
          where: { id: existing.id },
          data:  { firstName, lastName, phone: phone || null, address: address || null, answers: cleanAnswers, rsvp: "CONFIRME", rsvpAt: new Date(), ticketTypeId: ticketType?.id ?? null },
        })
        pid = existing.id
      } else {
        const created = await tx.participation.create({
          data: {
            evenementId: id,
            orderId,
            firstName, lastName,
            email:   email || null,
            phone:   phone || null,
            address: address || null,
            answers: cleanAnswers,
            rsvp:    "CONFIRME",
            rsvpAt:  new Date(),
            cancelToken,
            ticketTypeId: ticketType?.id ?? null,
          },
          select: { id: true },
        })
        pid = created.id
      }

      // Applies whether this seat is brand new or a reused/resumed row — a resumed row
      // that was never actually freed (still rsvp CONFIRME going in) is already counted
      // in `occupied` by itself, so this is a no-op for it; a genuinely re-activated
      // (previously cancelled) seat is what this is here to catch.
      if (evenement.capacity != null) {
        const occupied = await tx.participation.count({
          where: { evenementId: id, OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }] },
        })
        if (occupied > evenement.capacity) throw new EventFullError()
      }

      // Same post-write count-and-check as the event-level capacity above, scoped to the
      // one tier this registration used — self-correcting for resubmits since it counts
      // what's actually in the DB after the write, not a manual pre/post delta.
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
    if (email) {
      sendEmail(rsvpConfirmationEmail({
        firstName,
        email,
        associationName: assoc.name,
        eventTitle:      evenement.title,
        eventDate:       evenement.date,
        eventLocation:   evenement.location,
        portalUrl:       `${APP_URL}/${slug}/evenements/${id}`,
        cancelUrl:       `${APP_URL}/annulation/${cancelToken}`,
        branding:        resolveDocumentBranding(assoc),
      }), { associationId: assoc.id, source: "PUBLIC_EVENT_INSCRIPTION", sourceId: participationId }).catch(() => {})
    }
    // Without an email the visitor has no other way to ever see this again — the
    // confirmation screen tells them to save it, so it has to actually be here.
    return NextResponse.json({ ok: true, cancelUrl: `${APP_URL}/annulation/${cancelToken}` })
  }

  // A still-open session from a previous attempt (same email, resubmitting) can be
  // handed back as-is — nothing about a single-seat public registration ever changes
  // the amount, so there's no case where it needs replacing instead of reusing.
  if (existing?.stripeSessionId) {
    const existingSession = await stripe.checkout.sessions.retrieve(existing.stripeSessionId).catch(() => null)
    if (existingSession?.status === "open" && existingSession.url) {
      return NextResponse.json({ url: existingSession.url })
    }
  }

  const amountCents = Math.round(Number(ticketType?.price ?? evenement.price) * 100)
  const productName = ticketType ? `${assoc.name} — ${evenement.title} — ${ticketType.label}` : `${assoc.name} — ${evenement.title}`

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency:     "eur",
          unit_amount:  amountCents,
          product_data: { name: productName },
        },
        quantity: 1,
      },
    ],
    payment_intent_data: {
      transfer_data: { destination: assoc.stripeConnectId! },
      metadata:      { orderId, associationId: assoc.id },
    },
    metadata:      { orderId },
    customer_email: email || undefined,
    success_url: `${APP_URL}/${slug}/evenements/${id}?ticket=success`,
    cancel_url:  `${APP_URL}/${slug}/evenements/${id}?ticket=cancelled`,
    // Same reasoning as the portal checkout: the seat is already held (rsvp: CONFIRME)
    // before this session exists, so keep the hold window short instead of Stripe's
    // default 24h — an abandoned checkout shouldn't tie up a spot all day.
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
  })

  if (!checkoutSession.url) {
    // Best-effort cleanup — an orphaned hold is far less harmful than blocking the
    // response on a retryable failure the visitor can just resubmit past anyway. Only
    // safe to delete outright for a brand-new row; a reused row predates this request.
    if (!existing) await prisma.participation.delete({ where: { id: participationId } }).catch(() => {})
    return NextResponse.json({ error: "Impossible de créer la session de paiement" }, { status: 500 })
  }

  await prisma.participation.update({
    where: { id: participationId },
    data:  { stripeSessionId: checkoutSession.id },
  })

  return NextResponse.json({ url: checkoutSession.url })
}
