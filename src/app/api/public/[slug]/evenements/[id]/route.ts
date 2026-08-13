import { NextResponse } from "next/server"
import { getLocale } from "next-intl/server"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"
import { connectAccountChargesEnabled } from "@/lib/stripe"
import { translateFields } from "@/lib/i18n/translate"
import type { Locale } from "@/i18n/locales"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params

  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: { id: true, name: true, sitePublished: true, modules: true, stripeConnectId: true },
  })
  if (!assoc || !assoc.sitePublished) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const mods = parseModules(assoc.modules)
  if (!mods.site || !mods.evenements) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const evenement = await prisma.evenement.findFirst({
    where:  { id, associationId: assoc.id },
    select: {
      id: true, title: true, description: true, imageUrl: true, date: true, endDate: true,
      location: true, price: true, capacity: true,
      customFields: { orderBy: { order: "asc" }, select: { id: true, type: true, label: true, required: true } },
      ticketTypes:  { orderBy: { order: "asc" }, select: { id: true, label: true, price: true, capacity: true } },
      _count: { select: { participations: { where: { OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }] } } } },
    },
  })
  if (!evenement) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // The admin always writes this content in their own language — translate it for
  // visitors on the fly (cached per locale) rather than asking associations to
  // maintain multiple copies. Location is a street address, not content, so it's
  // left as-is — translating it would garble the "open in Google Maps" query.
  const locale = (await getLocale()) as Locale
  const [translated]  = await translateFields([{ title: evenement.title, description: evenement.description }], ["title", "description"], locale)
  const customFields  = await translateFields(evenement.customFields, ["label"], locale)
  const ticketTypes   = await translateFields(evenement.ticketTypes, ["label"], locale)

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

  const full = evenement.capacity != null && evenement._count.participations >= evenement.capacity
  const past = evenement.date < new Date()

  return NextResponse.json({
    associationName: assoc.name,
    id:          evenement.id,
    title:       translated.title,
    description: translated.description,
    imageUrl:    evenement.imageUrl,
    date:        evenement.date,
    endDate:     evenement.endDate,
    location:    evenement.location,
    price:       evenement.price?.toString() ?? null,
    capacity:    evenement.capacity,
    full,
    past,
    isPaid,
    paymentEnabled,
    customFields,
    ticketTypes: ticketTypes.map(tt => {
      const remaining = tt.capacity != null ? Math.max(0, tt.capacity - (occupiedMap.get(tt.id) ?? 0)) : null
      return { id: tt.id, label: tt.label, price: tt.price.toString(), remaining, full: remaining === 0 }
    }),
  })
}
