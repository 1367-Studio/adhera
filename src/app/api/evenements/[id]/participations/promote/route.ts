import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { sendEmail } from "@/lib/mail"
import { rsvpConfirmationEmail } from "@/lib/email"
import { APP_URL } from "@/lib/env"
import { resolveDocumentBranding } from "@/lib/plan-limits"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

class CapacityError extends Error {}

// Moves one waitlisted Participation to CONFIRME — a manual admin action, same trust level as
// adding a walk-in guest (no Stripe touch here, same as every other action on this page). The
// admin still has to collect payment afterwards through the normal mark-paid/offline flow if
// the tier isn't free — promoting only ever flips the seat status, never charges anyone.
export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id: evenementId }) => {
  const { associationId, role, userId } = ctx

  if (!MANAGERS.includes(role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const { participationId } = await req.json() as { participationId?: string }
  if (!participationId) return NextResponse.json({ error: "Participation introuvable" }, { status: 404 })

  const evenement = await prisma.evenement.findFirst({
    where:  { id: evenementId, associationId },
    select: { title: true, date: true, location: true, capacity: true, associationId: true },
  })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })

  const participation = await prisma.participation.findFirst({
    where:  { id: participationId, evenementId },
    include: { ticketType: { select: { id: true, label: true, capacity: true } } },
  })
  if (!participation) return NextResponse.json({ error: "Participation introuvable" }, { status: 404 })
  if (participation.rsvp !== "LISTA_ESPERA")
    return NextResponse.json({ error: "Cette inscription n'est pas en liste d'attente" }, { status: 422 })

  try {
    await prisma.$transaction(async (tx) => {
      // Re-check capacity right now — a spot could have filled again between the admin
      // opening the list and clicking "Promouvoir" (or another entry already got promoted
      // first).
      if (evenement.capacity != null) {
        const occupied = await tx.participation.count({
          where: { evenementId, OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }] },
        })
        if (occupied >= evenement.capacity!)
          throw new CapacityError("L'événement est toujours complet.")
      }
      if (participation.ticketType?.capacity != null) {
        const occupiedTier = await tx.participation.count({
          where: { evenementId, ticketTypeId: participation.ticketType.id, OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }] },
        })
        if (occupiedTier >= participation.ticketType.capacity)
          throw new CapacityError(`Le tarif « ${participation.ticketType.label} » est toujours complet.`)
      }

      // Un code promo appliqué pendant l'attente n'a jamais compté dans usesCount (voir
      // inscription/route.ts) — la promotion est le moment où l'usage devient réel. Revérifié
      // sous verrou ici, pas seulement au moment de l'inscription : le code a pu expirer,
      // s'épuiser ou être désactivé pendant que la personne attendait. S'il n'est plus valide,
      // la promotion n'est jamais bloquée pour autant (la capacité est ce qui compte ici) —
      // seul le rabais est abandonné, pour retomber sur le prix plein au moment du paiement.
      let discountFields: { discountCodeId: string | null; amount: null } | Record<string, never> = {}
      if (participation.discountCodeId) {
        const locked = await tx.$queryRaw<{ active: boolean; startsAt: Date | null; endsAt: Date | null; maxUses: number | null; usesCount: number }[]>`
          SELECT active, "startsAt", "endsAt", "maxUses", "usesCount" FROM "EvenementDiscountCode" WHERE id = ${participation.discountCodeId} FOR UPDATE
        `
        const row = locked[0]
        const now = new Date()
        const stillValid = !!row && row.active
          && (!row.startsAt || row.startsAt <= now) && (!row.endsAt || row.endsAt >= now)
          && (row.maxUses == null || row.usesCount < row.maxUses)
        if (stillValid) {
          await tx.evenementDiscountCode.update({ where: { id: participation.discountCodeId }, data: { usesCount: { increment: 1 } } })
        } else {
          discountFields = { discountCodeId: null, amount: null }
        }
      }

      await tx.participation.update({
        where: { id: participation.id },
        data:  { rsvp: "CONFIRME", rsvpAt: new Date(), ...discountFields },
      })
    })
  } catch (err) {
    if (err instanceof CapacityError) return NextResponse.json({ error: err.message }, { status: 422 })
    throw err
  }

  await writeActivityLog({
    associationId, actorId: userId, action: "PARTICIPATION_PROMOTED_FROM_WAITLIST", entity: "Participation", entityId: participation.id,
    label: `${participation.firstName} ${participation.lastName} — ${evenement.title}`,
  })

  if (participation.email) {
    const assoc = await prisma.association.findUnique({ where: { id: associationId }, select: { name: true, slug: true, plan: true, customBrandingEnabled: true, logoUrl: true } })
    if (assoc) {
      await sendEmail(rsvpConfirmationEmail({
        firstName: participation.firstName, email: participation.email,
        associationName: assoc.name,
        eventTitle:      evenement.title,
        eventDate:       evenement.date,
        eventLocation:   evenement.location,
        portalUrl:       `${APP_URL}/${assoc.slug}/evenements/${evenementId}`,
        cancelUrl:       participation.cancelToken ? `${APP_URL}/annulation/${participation.cancelToken}` : undefined,
        ticketQr: participation.ticketToken ? {
          imageUrl: `${APP_URL}/api/public/billet/${participation.ticketToken}/qr`,
          pageUrl:  `${APP_URL}/billet/${participation.ticketToken}`,
        } : undefined,
        branding: resolveDocumentBranding(assoc),
      }), { associationId, source: "PUBLIC_EVENT_INSCRIPTION", sourceId: participation.id }).catch(() => {})
    }
  }

  return NextResponse.json({ ok: true })
})
