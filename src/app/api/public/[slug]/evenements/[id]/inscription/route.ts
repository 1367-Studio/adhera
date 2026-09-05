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
import { rsvpConfirmationEmail, waitlistConfirmationEmail } from "@/lib/email"
import { notifyEventRegistration } from "@/lib/evenement-notify"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { createEvenementDonation } from "@/lib/webhook/evenement-addons"

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
  // birthDate/gender get their own Participation columns (mirrors Membre.birthDate/sexe) —
  // mobile has no dedicated column, same as Membre.answers's "mobile" convention, so it
  // rides in `answers` alongside the custom-field replies below.
  birthDate:    z.string().trim().optional().or(z.literal("")),
  gender:       z.enum(["HOMME", "FEMME"]).optional(),
  mobile:       z.string().trim().max(30).optional().or(z.literal("")),
  // Each ticket belongs to a different person, so custom-field answers (e.g. shirt size)
  // are asked and stored per attendee, not once for the whole order. A plain string for
  // every field type except CHECKBOX_MULTI, which answers with a string array — same
  // convention as Participation.answers itself (see schema.prisma).
  answers:      z.record(z.string(), z.union([z.string().max(500), z.array(z.string().max(500)).max(50)])).optional().default({}),
})

const baseSchema = z.object({
  // One entry per ticket — each ticket belongs to a different person, even within a
  // single order. Every submission (including a single ticket) goes through this array.
  attendees: z.array(attendeeSchema).min(1).max(MAX_QUANTITY),
  // Honeypot — a real visitor never sees or fills this field (hidden off-screen in the
  // public form); a non-empty value means a bot filled every input it could find.
  website:   z.string().optional().or(z.literal("")),
  // Offline choice, mirroring Don/Cotisation's own paymentMethod — only ever meaningful
  // for a single-attendee, paid order (see the isOffline guard below).
  paymentMethod: z.enum(["STRIPE", "ESPECES", "CHEQUE", "VIREMENT"]).optional().default("STRIPE"),
  // Optional donation(s) riding alongside the ticket, one Don per selected EvenementTicketType
  // with itemType == DONATION — only ever meaningful for a single-attendee order, same
  // restriction as products on the membership form (one Participation, one payment). Amount
  // is re-validated server-side against the tier's own minimum below, never trusted as-is.
  donations: z.array(z.object({ ticketTypeId: z.string(), amount: z.number().positive() })).max(10).optional().default([]),
  // Boutique products offered alongside the ticket (see EvenementProduct) — only ever
  // meaningful for a single-attendee order (one Participation, one payment, no per-seat stock
  // tracking), same restriction as the membership form's own products. Re-validated/re-priced
  // server-side against live stock below, never trusted as-is.
  products: z.array(z.object({ varianteId: z.string().min(1), quantity: z.number().int().min(1).max(99) })).max(10).optional().default([]),
  // CGU/signature — one agreement per submission (not per attendee), same convention as
  // Don/MembershipForm's own conditionsAgreed. Re-validated server-side below against
  // Evenement.requireCguvSignature, never trusted as-is.
  conditionsAgreed: z.boolean().optional().default(false),
  // Nom complet saisi comme preuve informelle de signature, à côté de la case à cocher — voir
  // Participation.signedName dans schema.prisma.
  signedName: z.string().trim().max(200).optional().or(z.literal("")),
  // Code promotionnel — même restriction one-per-order que donations/products ci-dessus (une
  // seule Participation à qui l'attribuer). Jamais fait confiance : revalidé ici du zéro contre
  // EvenementDiscountCode, jamais depuis ce que le client a résolu via /discount-code.
  discountCode: z.string().trim().max(30).optional().or(z.literal("")),
})

type ResolvedProduct = { varianteId: string; produitId: string; label: string; quantity: number; unitPriceCents: number }

// Mirror exact de resolveRequestedProducts du checkout d'adhésion (voir ce fichier) — validé/
// re-tarifé server-side à partir du stock/prix en direct, jamais repris du payload.
function resolveRequestedProducts(
  evenementProducts: { varianteId: string; variante: { id: string; produitId: string; label: string; price: number; stock: number; produit: { status: string } } }[],
  modules: { boutique: boolean },
  requested: { varianteId: string; quantity: number }[],
): { error: string } | { products: ResolvedProduct[]; totalCents: number } {
  const varianteIds = new Set(requested.map(p => p.varianteId))
  if (varianteIds.size !== requested.length) return { error: "Produits en double" }

  const products: ResolvedProduct[] = []
  for (const p of requested) {
    const offer = modules.boutique ? evenementProducts.find(ep => ep.varianteId === p.varianteId) : undefined
    if (!offer || offer.variante.produit.status !== "ACTIVE")
      return { error: "Produit invalide" }
    if (offer.variante.stock < p.quantity)
      return { error: `Stock insuffisant pour « ${offer.variante.label} » (disponible : ${offer.variante.stock})` }
    products.push({
      varianteId: offer.variante.id, produitId: offer.variante.produitId, label: offer.variante.label,
      quantity: p.quantity, unitPriceCents: offer.variante.price,
    })
  }
  return { products, totalCents: products.reduce((sum, p) => sum + p.unitPriceCents * p.quantity, 0) }
}

class EventFullError extends Error {}
class TicketTypeFullError extends Error {
  constructor(public label: string) { super() }
}
class DiscountCodeInvalidError extends Error {}

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

  const { attendees, paymentMethod, donations, products, conditionsAgreed, signedName, discountCode } = parsed.data
  const isOffline = paymentMethod !== "STRIPE"

  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: {
      id: true, name: true, slug: true, sitePublished: true, modules: true, stripeConnectId: true,
      plan: true, customBrandingEnabled: true, logoUrl: true, canIssueTaxReceipts: true,
    },
  })
  if (!assoc || !assoc.sitePublished) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const mods = parseModules(assoc.modules)
  if (!mods.site || !mods.evenements) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const evenement = await prisma.evenement.findFirst({
    where:   { id, associationId: assoc.id, status: "PUBLISHED", visibility: { not: "PRIVATE" } },
    include: {
      customFields: true, ticketTypes: true, discountCodes: true,
      products: { include: { variante: { include: { produit: { select: { status: true } } } } } },
    },
  })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })
  if (evenement.date < new Date())
    return NextResponse.json({ error: "Événement déjà passé" }, { status: 422 })
  const now = new Date()
  if (evenement.opensAt && evenement.opensAt > now)
    return NextResponse.json({ error: "Les inscriptions ne sont pas encore ouvertes." }, { status: 422 })
  if (evenement.closesAt && evenement.closesAt < now)
    return NextResponse.json({ error: "Les inscriptions sont closes." }, { status: 422 })

  // Le client refuse déjà de soumettre sans cette case cochée (+ nom saisi) quand l'événement
  // l'exige — revalidé ici pour ne jamais dépendre uniquement d'un contrôle contournable côté
  // client. Une seule signature par soumission (pas par participant), même convention que
  // Don/MembershipForm.conditionsAgreed.
  if (evenement.requireCguvSignature && (!conditionsAgreed || !signedName?.trim()))
    return NextResponse.json({ error: "Vous devez accepter les conditions et signer pour vous inscrire." }, { status: 422 })
  const cguvAgreedAt = conditionsAgreed ? now : null
  const cleanSignedName = signedName?.trim() || null

  // Standard fields (Formulaire step) are gated per-event, so a REQUIRED one must be
  // enforced here too, not just client-side — a direct API call could otherwise bypass it.
  const standardFieldChecks: [typeof evenement.fieldPhone, string, string][] = [
    [evenement.fieldPhone, "phone", "Téléphone"],
    [evenement.fieldAddress, "address", "Adresse"],
    [evenement.fieldMobile, "mobile", "Mobile"],
    [evenement.fieldBirthDate, "birthDate", "Date de naissance"],
    [evenement.fieldGender, "gender", "Genre"],
  ]
  for (const a of attendees) {
    for (const [requirement, key, label] of standardFieldChecks) {
      if (requirement === "REQUIRED" && !a[key as keyof typeof a])
        return NextResponse.json({ error: `Le champ « ${label} » est requis.` }, { status: 422 })
    }
  }

  // Custom fields are admin-defined per event, so their validation can't be a static
  // zod schema — required/type checked here against what's currently configured. Each
  // attendee answers their own copy (e.g. shirt size), so every attendee is checked.
  const knownFieldIds = new Set(evenement.customFields.map(f => f.id))
  for (const a of attendees) {
    for (const field of evenement.customFields) {
      const value = a.answers[field.id]
      const isEmpty = Array.isArray(value) ? value.length === 0 : (value == null || value.trim() === "")
      if (field.required && isEmpty) {
        return NextResponse.json({ error: `Le champ « ${field.label} » est requis.` }, { status: 422 })
      }
      if (isEmpty) continue

      // NUMBER/DATE/SELECT/RADIO expect a plain string answer — reject an array outright
      // instead of just skipping the type-specific check below when `typeof value` isn't a
      // string, otherwise a crafted `answers[fieldId] = ["x"]` would sail through unvalidated
      // (BOOLEAN/CHECKBOX_MULTI already reject a type mismatch this same way).
      if (field.type === "NUMBER") {
        if (typeof value !== "string") {
          return NextResponse.json({ error: `Le champ « ${field.label} » est invalide.` }, { status: 422 })
        }
        const n = Number(value)
        if (!Number.isInteger(n) || n < 0 || n > MAX_NUMBER_FIELD_VALUE) {
          return NextResponse.json({ error: `Le champ « ${field.label} » doit être un nombre entier valide.` }, { status: 422 })
        }
      }
      if (field.type === "DATE" && (typeof value !== "string" || isNaN(Date.parse(value)))) {
        return NextResponse.json({ error: `Le champ « ${field.label} » doit être une date valide.` }, { status: 422 })
      }
      if (field.type === "BOOLEAN" && value !== "true" && value !== "false") {
        return NextResponse.json({ error: `Le champ « ${field.label} » est invalide.` }, { status: 422 })
      }
      if (field.type === "SELECT" || field.type === "RADIO") {
        const options = Array.isArray(field.options) ? field.options as string[] : []
        if (typeof value !== "string" || !options.includes(value)) {
          return NextResponse.json({ error: `Le champ « ${field.label} » est invalide.` }, { status: 422 })
        }
      }
      if (field.type === "CHECKBOX_MULTI") {
        const options = Array.isArray(field.options) ? field.options as string[] : []
        if (!Array.isArray(value) || !value.every(v => options.includes(v))) {
          return NextResponse.json({ error: `Le champ « ${field.label} » est invalide.` }, { status: 422 })
        }
      }
    }
  }

  // Ticket types (when the admin defined any) replace the flat price entirely — every
  // attendee must have picked one, and its price (not evenement.price) drives everything
  // below for that seat. DONATION rows are optional extras, never a tier an attendee picks
  // as their seat — kept out of hasTicketTypes/resolveTicketType so they can never be passed
  // as a ticketTypeId and charged as if they were a real ticket price.
  // Inactive tiers (see EvenementTicketType.active) are invisible everywhere here, same as if
  // they didn't exist — a crafted request naming one still can't resolve it below, falling
  // through to the same INVALID_TICKET_TYPE rejection as an unknown id.
  const realTicketTypes    = evenement.ticketTypes.filter(tt => tt.itemType === "TICKET" && tt.active)
  const donationTicketTypes = evenement.ticketTypes.filter(tt => tt.itemType === "DONATION" && tt.active)
  const hasTicketTypes = realTicketTypes.length > 0
  const flatPrice      = evenement.price != null ? Number(evenement.price) : 0
  const resolveTicketType = (ticketTypeId: string | undefined) =>
    realTicketTypes.find(tt => tt.id === ticketTypeId) ?? null
  const resolvedAttendees = attendees.map(a => ({
    ...a,
    email:          a.email.toLowerCase(),
    ticketType:     hasTicketTypes ? resolveTicketType(a.ticketTypeId) : null,
    birthDateValue: a.birthDate ? new Date(a.birthDate) : null,
    // birthDate/gender have their own Participation columns — only "mobile" (no dedicated
    // column, same as Membre.answers) and known custom-field replies belong in `answers`.
    cleanAnswers: {
      ...(a.mobile ? { mobile: a.mobile } : {}),
      ...Object.fromEntries(Object.entries(a.answers).filter(([k]) => knownFieldIds.has(k))),
    },
  }))
  if (hasTicketTypes && resolvedAttendees.some(a => !a.ticketType)) {
    return NextResponse.json({ error: "Tarif invalide", code: "INVALID_TICKET_TYPE" }, { status: 422 })
  }
  // Own sale window per tier, in addition to the event-wide one already checked above — can
  // only narrow it further, never re-open past the event's own opensAt/closesAt.
  for (const a of resolvedAttendees) {
    if (!a.ticketType) continue
    if (a.ticketType.opensAt && a.ticketType.opensAt > now) {
      return NextResponse.json({ error: "Ce tarif n'est pas encore ouvert.", code: "TICKET_TYPE_NOT_OPEN" }, { status: 422 })
    }
    if (a.ticketType.closesAt && a.ticketType.closesAt < now) {
      return NextResponse.json({ error: "Ce tarif n'est plus disponible.", code: "TICKET_TYPE_CLOSED" }, { status: 422 })
    }
  }
  // Two seats in the same order sharing an email would otherwise silently create two
  // Participation rows with the same address — harmless by itself, but it makes the dedup
  // logic below ambiguous about which row is "the" registration for that email.
  if (new Set(resolvedAttendees.map(a => a.email)).size !== resolvedAttendees.length) {
    return NextResponse.json({ error: "Chaque billet doit utiliser une adresse e-mail différente.", code: "DUPLICATE_EMAIL" }, { status: 422 })
  }
  const seatPrice = (a: (typeof resolvedAttendees)[number]): number =>
    a.ticketType ? Number(a.ticketType.price) : flatPrice

  // Même restriction one-per-order que les dons/produits ci-dessous : une commande groupée n'a
  // pas de Participation unique à qui attribuer le code.
  if (discountCode && resolvedAttendees.length !== 1) {
    return NextResponse.json({ error: "Un code promotionnel ne peut être appliqué que pour une inscription individuelle." }, { status: 400 })
  }
  const normalizedDiscountCode = discountCode?.trim().toUpperCase() || null
  // Résolu/validé une première fois ici (message d'erreur immédiat, hors transaction) ; revalidé
  // avec un verrou FOR UPDATE sur la ligne dans la transaction ci-dessous pour l'atomicité de
  // usesCount (voir la section single-ticket order).
  let discountCodeRow: (typeof evenement.discountCodes)[number] | null = null
  if (normalizedDiscountCode) {
    const attendee    = resolvedAttendees[0]
    const dc          = evenement.discountCodes.find(d => d.code === normalizedDiscountCode) ?? null
    const withinWindow = !!dc && (!dc.startsAt || dc.startsAt <= now) && (!dc.endsAt || dc.endsAt >= now)
    const hasUsesLeft  = !!dc && (dc.maxUses == null || dc.usesCount < dc.maxUses)
    // Vide = s'applique à toutes les tarifs TICKET (et au prix unique de l'événement, quand il
    // n'y a pas de tarifs) — voir le commentaire du champ ticketTypeIds dans schema.prisma.
    const appliesToTicket = !!dc && (dc.ticketTypeIds.length === 0 ? true : (!!attendee.ticketType && dc.ticketTypeIds.includes(attendee.ticketType.id)))
    if (!dc || !dc.active || !withinWindow || !hasUsesLeft || !appliesToTicket) {
      return NextResponse.json({ error: "Ce code promotionnel n'est plus valide.", code: "DISCOUNT_CODE_INVALID" }, { status: 422 })
    }
    discountCodeRow = dc
  }
  const discountedSeatPrice = (a: (typeof resolvedAttendees)[number]): number => {
    if (!discountCodeRow) return seatPrice(a)
    const price = seatPrice(a)
    const discounted = discountCodeRow.kind === "PERCENT" ? price * (1 - Number(discountCodeRow.value) / 100) : price - Number(discountCodeRow.value)
    return Math.max(0, discounted)
  }

  // Same restriction as products on the membership form: a grouped order has no single
  // Participation to attribute a donation to, so it's rejected outright rather than
  // silently attaching it to just one of several attendees.
  if (donations.length > 0 && resolvedAttendees.length !== 1) {
    return NextResponse.json({ error: "Un don ne peut être ajouté que pour une inscription individuelle." }, { status: 400 })
  }
  const resolvedDonations: { tier: (typeof donationTicketTypes)[number]; amount: number }[] = []
  for (const d of donations) {
    const tier = donationTicketTypes.find(tt => tt.id === d.ticketTypeId)
    if (!tier) return NextResponse.json({ error: "Don invalide" }, { status: 422 })
    if (d.amount < Number(tier.price)) return NextResponse.json({ error: "Montant du don inférieur au minimum" }, { status: 422 })
    resolvedDonations.push({ tier, amount: d.amount })
  }
  const donationsTotal = resolvedDonations.reduce((sum, d) => sum + d.amount, 0)

  // Same restriction as the embedded donation above: a grouped order has no single
  // Participation to attribute products to, so it's rejected outright rather than silently
  // attaching them to just one of several attendees.
  if (products.length > 0 && resolvedAttendees.length !== 1) {
    return NextResponse.json({ error: "Un produit ne peut être ajouté que pour une inscription individuelle." }, { status: 400 })
  }
  const productsResult = resolveRequestedProducts(evenement.products, mods, products)
  if ("error" in productsResult) return NextResponse.json({ error: productsResult.error }, { status: 422 })
  const { products: resolvedProducts, totalCents: totalProductsCents } = productsResult
  const productsTotal = totalProductsCents / 100

  const isPaid = resolvedAttendees.some(a => seatPrice(a) > 0) || donationsTotal > 0 || productsTotal > 0

  if (isOffline) {
    // Same restriction as the membership/donation public forms' own offline chooser — a
    // grouped multi-seat order has no single Participation.paymentMethod/ticketPaidAt pair
    // to carry an offline choice for the whole group.
    if (!isPaid || resolvedAttendees.length !== 1) {
      return NextResponse.json({ error: "Le paiement hors ligne n'est disponible que pour une inscription individuelle et payante." }, { status: 400 })
    }
    // A product is never decremented/sold except via the Stripe webhook (see
    // evenement-products.ts) — an offline payment never goes through that webhook.
    if (resolvedProducts.length > 0)
      return NextResponse.json({ error: "Le paiement hors ligne n'est pas disponible avec des produits." }, { status: 400 })
    const allowed = paymentMethod === "ESPECES" ? evenement.allowCash : paymentMethod === "CHEQUE" ? evenement.allowCheque : evenement.allowTransfer
    if (!allowed) return NextResponse.json({ error: "Ce moyen de paiement n'est pas disponible pour cet événement." }, { status: 400 })
  } else if (isPaid && (!assoc.stripeConnectId || !(await connectAccountChargesEnabled(assoc.stripeConnectId)))) {
    return NextResponse.json({ error: "Paiement en ligne non disponible pour cette association" }, { status: 400 })
  }

  // ---- Single-ticket order: same resume/reuse behavior as before tickets could be ----
  // ---- grouped — an abandoned checkout can be picked back up from the same email.  ----
  if (resolvedAttendees.length === 1) {
    const attendee = resolvedAttendees[0]
    const { firstName, lastName, email, ticketType, phone, address, birthDateValue, gender, cleanAnswers } = attendee

    // Dedup by email — only meaningful for the resume/reuse logic below.
    const existing = await prisma.participation.findFirst({
      where:  { evenementId: id, email: { equals: email, mode: "insensitive" } },
      select: { id: true, ticketPaidAt: true, stripeSessionId: true, orderId: true, rsvp: true, ticketTypeId: true, ticketToken: true, discountCodeId: true },
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
    let waitlisted = false
    try {
      ;({ pid: participationId, waitlisted } = await prisma.$transaction(async (tx) => {
        if (evenement.capacity != null || evenement.ticketTypes.some(tt => tt.capacity != null)) {
          await tx.$queryRaw`SELECT id FROM "Evenement" WHERE id = ${id} FOR UPDATE`
        }

        // Snapshot immédiat (pas seulement au paiement confirmé) — permet au webhook Stripe et
        // à l'admin "marquer payé" d'utiliser ce montant déjà remisé au lieu de recalculer depuis
        // le prix de tabale de la tarif, qui ignorerait silencieusement toute remise. Voir les
        // commentaires de Participation.amount/discountCodeId dans schema.prisma.
        const discountFields = {
          discountCodeId: discountCodeRow?.id ?? null,
          ...(isPaid ? { amount: discountedSeatPrice(attendee) } : {}),
        }

        let pid: string
        if (existing) {
          await tx.participation.update({
            where: { id: existing.id },
            data:  { firstName, lastName, phone: phone || null, address: address || null, birthDate: birthDateValue, gender: gender ?? null, answers: cleanAnswers, rsvp: "CONFIRME", rsvpAt: new Date(), ticketTypeId: ticketType?.id ?? null, ticketToken, paymentMethod: isOffline ? paymentMethod : null, cguvAgreedAt, signedName: cleanSignedName, ...discountFields },
          })
          pid = existing.id
        } else {
          const created = await tx.participation.create({
            data: {
              associationId: assoc.id,
              evenementId: id,
              orderId,
              firstName, lastName, email,
              phone:     phone || null,
              address:   address || null,
              birthDate: birthDateValue,
              gender:    gender ?? null,
              answers: cleanAnswers,
              rsvp:    "CONFIRME",
              rsvpAt:  new Date(),
              cancelToken,
              ticketToken,
              ticketTypeId: ticketType?.id ?? null,
              paymentMethod: isOffline ? paymentMethod : null,
              cguvAgreedAt, signedName: cleanSignedName,
              ...discountFields,
            },
            select: { id: true },
          })
          pid = created.id
        }

        // Waitlist check happens before the donation/payment block below — a waitlisted
        // registrant never pays anything up front, whatever payment method was chosen.
        let isWaitlisted = false
        if (evenement.capacity != null) {
          const occupied = await tx.participation.count({
            where: { evenementId: id, OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }] },
          })
          if (occupied > evenement.capacity) {
            if (!evenement.waitlistEnabled) throw new EventFullError()
            isWaitlisted = true
          }
        }

        if (!isWaitlisted && ticketType?.capacity != null) {
          const occupiedTier = await tx.participation.count({
            where: { evenementId: id, ticketTypeId: ticketType.id, OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }] },
          })
          if (occupiedTier > ticketType.capacity) {
            if (!evenement.waitlistEnabled) throw new TicketTypeFullError(ticketType.label)
            isWaitlisted = true
          }
        }

        if (isWaitlisted) {
          await tx.participation.update({ where: { id: pid }, data: { rsvp: "LISTA_ESPERA" } })
          return { pid, waitlisted: true }
        }

        // usesCount ne bouge que pour une inscription qui aboutit réellement (pas en liste
        // d'attente) — verrou FOR UPDATE pour l'atomicité face à deux commandes concurrentes sur
        // le même code, revalidé ici pour de vrai (le check plus haut n'était qu'indicatif, hors
        // transaction). Une resoumission qui change/retire le code décrémente l'ancien avant
        // d'incrémenter le nouveau, pour ne jamais laisser usesCount dériver.
        const previousDiscountCodeId = existing?.discountCodeId ?? null
        if (previousDiscountCodeId && previousDiscountCodeId !== discountCodeRow?.id) {
          await tx.evenementDiscountCode.updateMany({
            where: { id: previousDiscountCodeId, usesCount: { gt: 0 } },
            data:  { usesCount: { decrement: 1 } },
          })
        }
        if (discountCodeRow && previousDiscountCodeId !== discountCodeRow.id) {
          const locked = await tx.$queryRaw<{ active: boolean; maxUses: number | null; usesCount: number }[]>`
            SELECT active, "maxUses", "usesCount" FROM "EvenementDiscountCode" WHERE id = ${discountCodeRow.id} FOR UPDATE
          `
          const row = locked[0]
          if (!row || !row.active || (row.maxUses != null && row.usesCount >= row.maxUses)) throw new DiscountCodeInvalidError()
          await tx.evenementDiscountCode.update({ where: { id: discountCodeRow.id }, data: { usesCount: { increment: 1 } } })
        }

        // Offline donations are recorded pending encaissement right away, same as the
        // ticket itself — the Stripe-paid path instead stashes this in the checkout
        // session's metadata and only creates the Don once the webhook confirms payment.
        if (isOffline && resolvedDonations.length > 0) {
          await createEvenementDonation(tx, {
            associationId: assoc.id, firstName, lastName, email,
            donations: resolvedDonations.map(d => ({ ticketTypeId: d.tier.id, label: d.tier.label, amount: d.amount, receiptMode: d.tier.receiptMode as "NONE" | "FULL" })),
            canIssueTaxReceipts: assoc.canIssueTaxReceipts,
            donPaymentMethod: paymentMethod as "ESPECES" | "CHEQUE" | "VIREMENT",
            donPaidAt: null,
          })
        }

        return { pid, waitlisted: false }
      }))
    } catch (err) {
      if (err instanceof EventFullError) return NextResponse.json({ error: "Événement complet" }, { status: 422 })
      if (err instanceof TicketTypeFullError) return NextResponse.json({ error: `Le tarif « ${err.label} » est complet`, code: "TICKET_TYPE_FULL" }, { status: 422 })
      if (err instanceof DiscountCodeInvalidError) return NextResponse.json({ error: "Ce code promotionnel n'est plus valide.", code: "DISCOUNT_CODE_INVALID" }, { status: 422 })
      throw err
    }

    await writeActivityLog({
      associationId: assoc.id, action: waitlisted ? "PARTICIPATION_WAITLISTED" : "PARTICIPATION_PUBLIC_CREATED", entity: "Participation", entityId: participationId,
      label: `${firstName} ${lastName} — ${evenement.title}`,
    })

    if (waitlisted) {
      await sendEmail(waitlistConfirmationEmail({
        firstName, email,
        associationName: assoc.name,
        eventTitle:      evenement.title,
        eventDate:       evenement.date,
        eventLocation:   evenement.location,
        portalUrl:       `${APP_URL}/${slug}/evenements/${id}`,
        cancelUrl:       `${APP_URL}/annulation/${cancelToken}`,
        branding:        resolveDocumentBranding(assoc),
      }), { associationId: assoc.id, source: "PUBLIC_EVENT_INSCRIPTION", sourceId: participationId }).catch(() => {})
      await notifyEventRegistration({
        associationId: assoc.id, evenementId: id, eventTitle: evenement.title, eventDate: evenement.date,
        attendeeNames: [`${firstName} ${lastName}`], amount: 0,
        adminNotificationEmail: evenement.adminNotificationEmail,
      }).catch(() => {})
      return NextResponse.json({ ok: true, waitlisted: true })
    }

    if (!isPaid || isOffline) {
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
      // Awaited like the confirmation above it: this route runs serverless, and an execution
      // frozen right after the response would drop a fire-and-forget notification. An offline
      // choice still owes money (unlike the free path above it) — the admin confirms receipt
      // later via the same "marquer payé" flow as a walk-in cash entry (see
      // /api/evenements/[id]/participations), which is what actually sets ticketPaidAt/amount.
      await notifyEventRegistration({
        associationId: assoc.id, evenementId: id, eventTitle: evenement.title, eventDate: evenement.date,
        attendeeNames: [`${firstName} ${lastName}`], amount: isOffline ? discountedSeatPrice(attendee) : 0,
        adminNotificationEmail: evenement.adminNotificationEmail,
      }).catch(() => {})
      return NextResponse.json({ ok: true })
    }

    if (existing?.stripeSessionId) {
      const existingSession = await stripe.checkout.sessions.retrieve(existing.stripeSessionId).catch(() => null)
      if (existingSession?.status === "open" && existingSession.url) {
        return NextResponse.json({ url: existingSession.url })
      }
    }

    const amountCents = Math.round(discountedSeatPrice(attendee) * 100)
    const productName = ticketType ? `${assoc.name} — ${evenement.title} — ${ticketType.label}` : `${assoc.name} — ${evenement.title}`
    // One line item per donation, alongside the ticket — a single combined checkout, same
    // pattern as the membership form's own embedded-donation line items. Snapshotted into
    // Stripe metadata (full keys, not the minimal {v,q} convention used for products — same
    // reasoning as membership's own `addons` metadata: cheap enough at this cardinality) so
    // the webhook can create the actual Don row(s) once payment is confirmed.
    const donationLineItems = resolvedDonations.map(d => ({
      price_data: { currency: "eur", unit_amount: Math.round(d.amount * 100), product_data: { name: `${assoc.name} — ${d.tier.label}` } },
      quantity: 1,
    }))
    // Boutique products chosen alongside the ticket — same combined-checkout pattern as the
    // donation line items above. Only identity+quantity ride in metadata (not label/price,
    // always re-derived live at webhook time — see evenement-products.ts), same {v,q}
    // convention as the membership form's own products metadata.
    const productLineItems = resolvedProducts.map(p => ({
      price_data: { currency: "eur", unit_amount: p.unitPriceCents, product_data: { name: `${p.label} — ${assoc.name}` } },
      quantity: p.quantity,
    }))

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        { price_data: { currency: "eur", unit_amount: amountCents, product_data: { name: productName } }, quantity: 1 },
        ...donationLineItems,
        ...productLineItems,
      ],
      payment_intent_data: { transfer_data: { destination: assoc.stripeConnectId! }, metadata: { orderId, associationId: assoc.id } },
      metadata: {
        orderId,
        ...(resolvedDonations.length > 0 ? { donations: JSON.stringify(resolvedDonations.map(d => ({ ticketTypeId: d.tier.id, label: d.tier.label, amount: d.amount, receiptMode: d.tier.receiptMode }))) } : {}),
        ...(resolvedProducts.length > 0 ? { products: JSON.stringify(resolvedProducts.map(p => ({ v: p.varianteId, q: p.quantity }))) } : {}),
      },
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
  let groupWaitlisted = false
  try {
    ;({ ids: participationIds, waitlisted: groupWaitlisted } = await prisma.$transaction(async (tx) => {
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
            associationId: assoc.id,
            evenementId: id,
            orderId,
            firstName: a.firstName,
            lastName:  a.lastName,
            email:     a.email,
            phone:     a.phone || null,
            address:   a.address || null,
            birthDate: a.birthDateValue,
            gender:    a.gender ?? null,
            answers:   a.cleanAnswers,
            rsvp:      "CONFIRME",
            rsvpAt:  new Date(),
            cancelToken:  cancelTokens[i],
            ticketToken:  ticketTokens[i],
            ticketTypeId: a.ticketType?.id ?? null,
            cguvAgreedAt, signedName: cleanSignedName,
          },
          select: { id: true },
        })
        ids.push(created.id)
      }

      // Same all-or-nothing reasoning as the mutual restrictions on donations/products above:
      // a group booking has no single seat to bump to the waitlist, so if it doesn't fit,
      // the whole order goes to the waitlist together rather than picking who among them
      // gets in — same as offline payment already treats a multi-seat order as one unit.
      let isWaitlisted = false
      if (evenement.capacity != null) {
        const occupied = await tx.participation.count({
          where: { evenementId: id, OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }] },
        })
        if (occupied > evenement.capacity) {
          if (!evenement.waitlistEnabled) throw new EventFullError()
          isWaitlisted = true
        }
      }

      // Per-tier occupancy for every distinct capped tier actually used in this order.
      const cappedTiers = [...new Set(
        newAttendees.map(a => a.ticketType).filter((t): t is NonNullable<typeof t> => t != null && t.capacity != null),
      )]
      if (!isWaitlisted && cappedTiers.length) {
        const occupancy = await tx.participation.groupBy({
          by:     ["ticketTypeId"],
          where:  { evenementId: id, ticketTypeId: { in: cappedTiers.map(tt => tt.id) }, OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }] },
          _count: { _all: true },
        })
        const occupiedMap = new Map(occupancy.map(o => [o.ticketTypeId, o._count._all]))
        for (const tt of cappedTiers) {
          if ((occupiedMap.get(tt.id) ?? 0) > tt.capacity!) {
            if (!evenement.waitlistEnabled) throw new TicketTypeFullError(tt.label)
            isWaitlisted = true
          }
        }
      }

      if (isWaitlisted) {
        await tx.participation.updateMany({ where: { id: { in: ids } }, data: { rsvp: "LISTA_ESPERA" } })
      }

      return { ids, waitlisted: isWaitlisted }
    }))
  } catch (err) {
    if (err instanceof EventFullError) return NextResponse.json({ error: "Événement complet" }, { status: 422 })
    if (err instanceof TicketTypeFullError) return NextResponse.json({ error: `Le tarif « ${err.label} » est complet`, code: "TICKET_TYPE_FULL" }, { status: 422 })
    throw err
  }

  await Promise.all(newAttendees.map((a, i) => writeActivityLog({
    associationId: assoc.id, action: groupWaitlisted ? "PARTICIPATION_WAITLISTED" : "PARTICIPATION_PUBLIC_CREATED", entity: "Participation", entityId: participationIds[i],
    label: `${a.firstName} ${a.lastName} — ${evenement.title}`,
  })))

  if (groupWaitlisted) {
    await Promise.all(newAttendees.map((a, i) => sendEmail(waitlistConfirmationEmail({
      firstName: a.firstName,
      email:     a.email,
      associationName: assoc.name,
      eventTitle:      evenement.title,
      eventDate:       evenement.date,
      eventLocation:   evenement.location,
      portalUrl:       `${APP_URL}/${slug}/evenements/${id}`,
      cancelUrl:       `${APP_URL}/annulation/${cancelTokens[i]}`,
      branding:        resolveDocumentBranding(assoc),
    }), { associationId: assoc.id, source: "PUBLIC_EVENT_INSCRIPTION", sourceId: participationIds[i] }).catch(() => {})))
    await notifyEventRegistration({
      associationId: assoc.id, evenementId: id, eventTitle: evenement.title, eventDate: evenement.date,
      attendeeNames: newAttendees.map(a => `${a.firstName} ${a.lastName}`), amount: 0,
      adminNotificationEmail: evenement.adminNotificationEmail,
    }).catch(() => {})
    return NextResponse.json({ ok: true, waitlisted: true, skippedEmails })
  }

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
    // One notification for the whole order, not one per seat — a family booking four places
    // is a single thing that happened, and four identical bells would read as four bookings.
    await notifyEventRegistration({
      associationId: assoc.id, evenementId: id, eventTitle: evenement.title, eventDate: evenement.date,
      attendeeNames: newAttendees.map(a => `${a.firstName} ${a.lastName}`), amount: 0,
      adminNotificationEmail: evenement.adminNotificationEmail,
    }).catch(() => {})
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
