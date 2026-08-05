import { NextResponse } from "next/server"
import { randomUUID } from "crypto"
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
})

class EventFullError extends Error {}

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
      plan: true, customBrandingEnabled: true, logoUrl: true, primaryColor: true,
    },
  })
  if (!assoc || !assoc.sitePublished) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const mods = parseModules(assoc.modules)
  if (!mods.site || !mods.evenements) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const evenement = await prisma.evenement.findFirst({
    where:   { id, associationId: assoc.id },
    include: { customFields: true },
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

  const isPaid = evenement.price != null && Number(evenement.price) > 0
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
        select: { id: true, ticketPaidAt: true, stripeSessionId: true, orderId: true },
      })
    : null

  if (existing && (!isPaid || existing.ticketPaidAt)) {
    return NextResponse.json({ error: "Vous êtes déjà inscrit(e) à cet événement avec cette adresse e-mail." }, { status: 409 })
  }

  // existing here (if any) is necessarily a paid event's abandoned/in-progress checkout —
  // reuse that same row instead of minting a second one that would double-count capacity.
  const orderId = existing?.orderId ?? randomUUID()

  let participationId: string
  try {
    participationId = await prisma.$transaction(async (tx) => {
      if (existing) {
        await tx.participation.update({
          where: { id: existing.id },
          data:  { firstName, lastName, phone: phone || null, address: address || null, answers: cleanAnswers, rsvp: "CONFIRME", rsvpAt: new Date() },
        })
        return existing.id
      }

      if (evenement.capacity != null) {
        // Serialize concurrent registrations for this event, same lock used by the
        // portal ticket checkout — without it, two public visitors racing for the last
        // spot could both pass the occupancy check below.
        await tx.$queryRaw`SELECT id FROM "Evenement" WHERE id = ${id} FOR UPDATE`
      }

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
        },
        select: { id: true },
      })

      if (evenement.capacity != null) {
        const occupied = await tx.participation.count({
          where: { evenementId: id, OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }] },
        })
        if (occupied > evenement.capacity) throw new EventFullError()
      }

      return created.id
    })
  } catch (err) {
    if (err instanceof EventFullError) return NextResponse.json({ error: "Événement complet" }, { status: 422 })
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
        branding:        resolveDocumentBranding(assoc),
      }), { associationId: assoc.id, source: "PUBLIC_EVENT_INSCRIPTION", sourceId: participationId }).catch(() => {})
    }
    return NextResponse.json({ ok: true })
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

  const amountCents = Math.round(Number(evenement.price) * 100)

  const checkoutSession = await stripe.checkout.sessions.create({
    mode: "payment",
    line_items: [
      {
        price_data: {
          currency:     "eur",
          unit_amount:  amountCents,
          product_data: { name: `${assoc.name} — ${evenement.title}` },
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
