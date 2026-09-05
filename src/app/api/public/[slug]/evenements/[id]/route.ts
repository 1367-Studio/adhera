import { NextResponse } from "next/server"
import { getLocale } from "next-intl/server"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"
import { connectAccountChargesEnabled } from "@/lib/stripe"
import { translateFields } from "@/lib/i18n/translate"
import { canPreviewForm } from "@/lib/form-preview"
import type { Locale } from "@/i18n/locales"

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params

  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: { id: true, name: true, sitePublished: true, modules: true, stripeConnectId: true, canIssueTaxReceipts: true },
  })
  if (!assoc || !assoc.sitePublished) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const mods = parseModules(assoc.modules)
  if (!mods.site || !mods.evenements) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // `?preview=1` lets a logged-in manager open a DRAFT/PRIVATE event exactly as a visitor
  // would see it (the wizard's "Aperçu" button) — same convention as the adhesion/donation
  // public routes. Anyone else keeps the normal PUBLISHED-only gate.
  const preview = await canPreviewForm(req, assoc.id)

  const evenement = await prisma.evenement.findFirst({
    where: {
      id, associationId: assoc.id,
      ...(preview ? {} : { status: "PUBLISHED" as const, visibility: { not: "PRIVATE" as const } }),
    },
    select: {
      id: true, title: true, description: true, imageUrl: true, date: true, endDate: true,
      location: true, price: true, capacity: true, opensAt: true, closesAt: true,
      contactEmail: true, contactPhone: true,
      fieldPhone: true, fieldAddress: true, fieldBirthDate: true, fieldGender: true, fieldMobile: true,
      allowCash: true, allowCheque: true, allowTransfer: true,
      offlineInstructions: true, confirmationMessage: true,
      conditions: true, attachments: true, requireCguvSignature: true,
      customFields: { orderBy: { order: "asc" }, select: { id: true, type: true, label: true, required: true, options: true } },
      ticketTypes:  { where: { active: true }, orderBy: { order: "asc" }, select: { id: true, itemType: true, label: true, price: true, priceBeforeDiscount: true, capacity: true, receiptMode: true, ineligibleAmount: true, opensAt: true, closesAt: true } },
      products: {
        orderBy: { order: "asc" },
        include: {
          variante: {
            select: {
              id: true, label: true, price: true, stock: true,
              produit: { select: { id: true, name: true, status: true, imageUrl: true } },
            },
          },
        },
      },
      _count: { select: { participations: { where: { OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }] } } } },
    },
  })
  if (!evenement) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const now        = new Date()
  const notOpenYet = !preview && !!evenement.opensAt  && evenement.opensAt  > now
  const closed     = !preview && !!evenement.closesAt && evenement.closesAt < now

  // The admin always writes this content in their own language — translate it for
  // visitors on the fly (cached per locale) rather than asking associations to
  // maintain multiple copies. Location is a street address, not content, so it's
  // left as-is — translating it would garble the "open in Google Maps" query.
  const locale = (await getLocale()) as Locale
  const [translated]  = await translateFields(
    [{ title: evenement.title, description: evenement.description, conditions: evenement.conditions }],
    ["title", "description", "conditions"],
    locale,
  )
  const customFields  = await translateFields(evenement.customFields, ["label"], locale)
  const allTicketTypes = await translateFields(evenement.ticketTypes, ["label"], locale)
  // DONATION rows are optional extras alongside the ticket, never a tier a participant picks
  // one of — kept out of `ticketTypes`/`hasTicketTypes` entirely so an event that only offers
  // a donation (no real ticket) doesn't force the "choose your tier" picker with nothing to
  // actually pick. See EvenementTicketType.itemType.
  const ticketTypes  = allTicketTypes.filter(tt => tt.itemType === "TICKET")
  const donationExtras = allTicketTypes.filter(tt => tt.itemType === "DONATION")

  // Per-tier occupancy, only worth a query when at least one tier actually caps seats.
  const cappedTicketTypeIds = ticketTypes.filter(tt => tt.capacity != null).map(tt => tt.id)
  const occupancyByTicketType = cappedTicketTypeIds.length
    ? await prisma.participation.groupBy({
        by:     ["ticketTypeId"],
        where:  { ticketTypeId: { in: cappedTicketTypeIds }, OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }] },
        _count: { _all: true },
      })
    : []
  const occupiedMap = new Map(occupancyByTicketType.map(o => [o.ticketTypeId, o._count._all]))

  // Ticket types (when the admin defined any) replace the single flat price entirely —
  // isPaid then reflects whether ANY tier costs something, not the ignored evenement.price.
  const hasTicketTypes = ticketTypes.length > 0
  const isPaid = hasTicketTypes
    ? ticketTypes.some(tt => Number(tt.price) > 0)
    : evenement.price != null && Number(evenement.price) > 0

  // Same reasoning as the public don route: a Connect id can exist before onboarding is
  // actually complete, so this drives whether the form renders as payable — the POST
  // route re-checks for real before any money moves.
  let paymentEnabled = !isPaid
  if (isPaid && assoc.stripeConnectId) {
    try {
      paymentEnabled = await connectAccountChargesEnabled(assoc.stripeConnectId)
    } catch (err) {
      console.error(`[public-evenement] failed to check payment availability for ${slug}/${id}:`, err)
    }
  }

  // Separate from `paymentEnabled` above, which only reflects whether *this event's own
  // ticket* is payable and skips the Stripe check entirely for free events — the
  // post-registration donation prompt needs its own signal regardless of the event's price.
  let donationsEnabled = false
  if (mods.dons && assoc.stripeConnectId) {
    try {
      donationsEnabled = await connectAccountChargesEnabled(assoc.stripeConnectId)
    } catch (err) {
      console.error(`[public-evenement] failed to check donation availability for ${slug}/${id}:`, err)
    }
  }

  const full = evenement.capacity != null && evenement._count.participations >= evenement.capacity
  const past = evenement.date < new Date()
  const remainingCapacity = evenement.capacity != null
    ? Math.max(0, evenement.capacity - evenement._count.participations)
    : null

  return NextResponse.json({
    associationName: assoc.name,
    id:          evenement.id,
    title:       translated.title,
    description: translated.description,
    imageUrl:    evenement.imageUrl,
    date:        evenement.date,
    endDate:     evenement.endDate,
    location:    evenement.location,
    contactEmail: evenement.contactEmail,
    contactPhone: evenement.contactPhone,
    price:       evenement.price?.toString() ?? null,
    capacity:    evenement.capacity,
    remainingCapacity,
    full,
    past,
    notOpenYet,
    closed,
    isPaid,
    paymentEnabled,
    donationsEnabled,
    canIssueTaxReceipts: assoc.canIssueTaxReceipts,
    fieldPhone:     evenement.fieldPhone,
    fieldAddress:   evenement.fieldAddress,
    fieldBirthDate: evenement.fieldBirthDate,
    fieldGender:    evenement.fieldGender,
    fieldMobile:    evenement.fieldMobile,
    allowCash:              evenement.allowCash,
    allowCheque:            evenement.allowCheque,
    allowTransfer:          evenement.allowTransfer,
    offlineInstructions:    evenement.offlineInstructions,
    confirmationMessage:    evenement.confirmationMessage,
    conditions:             translated.conditions,
    attachments:            evenement.attachments ?? [],
    requireCguvSignature:   evenement.requireCguvSignature,
    customFields,
    ticketTypes: ticketTypes.map(tt => {
      const remaining = tt.capacity != null ? Math.max(0, tt.capacity - (occupiedMap.get(tt.id) ?? 0)) : null
      // Same notOpenYet/closed convention as the event-level gate above, just scoped to this
      // one tier's own window (see EvenementTicketType.opensAt/closesAt) — never bypassed by
      // `preview`-less requests, but a manager previewing a draft event can still see every
      // tier regardless of its own window, same as the event-level gate.
      const notOpenYet = !preview && !!tt.opensAt && tt.opensAt > now
      const closed     = !preview && !!tt.closesAt && tt.closesAt < now
      return {
        id: tt.id, label: tt.label, price: tt.price.toString(), priceBeforeDiscount: tt.priceBeforeDiscount?.toString() ?? null,
        remaining, full: remaining === 0, notOpenYet, closed,
        receiptMode: tt.receiptMode, ineligibleAmount: tt.ineligibleAmount?.toString() ?? null,
      }
    }),
    // Optional donation checkbox(es) alongside the ticket — `price` here is a minimum, not a
    // fixed amount, same convention as MembershipTier.itemType == DONATION.
    donationExtras: donationExtras.map(tt => ({
      id: tt.id, label: tt.label, minAmount: tt.price.toString(), receiptMode: tt.receiptMode, ineligibleAmount: tt.ineligibleAmount?.toString() ?? null,
    })),
    // Un produit archivé après avoir été lié à l'événement n'est pas retiré de
    // EvenementProduct — filtré ici à la lecture, même logique que le formulaire d'adhésion.
    // Si le module Boutique a été désactivé depuis, les offres existantes ne doivent pas non
    // plus rester achetables publiquement.
    products: !mods.boutique ? [] : evenement.products
      .filter(p => p.variante.produit.status === "ACTIVE")
      .map(p => ({
        id:              p.id,
        varianteId:      p.variante.id,
        variantLabel:    p.variante.label,
        price:           p.variante.price,
        stock:           p.variante.stock,
        productId:       p.variante.produit.id,
        productName:     p.variante.produit.name,
        productImageUrl: p.variante.produit.imageUrl,
      })),
  })
}
