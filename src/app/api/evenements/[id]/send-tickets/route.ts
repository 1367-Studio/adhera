import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { writeActivityLog } from "@/lib/activity-log"
import { sendEmailBulk } from "@/lib/mail"
import { ticketQrDeliveryEmail } from "@/lib/email"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { APP_URL } from "@/lib/env"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

// Backfills Participation.ticketToken for this event's attendees registered before entry
// QR codes existed (their confirmation email carried none) and emails each of them their
// QR — so every ticket at the door can be scanned, not just post-feature ones. Idempotent
// by construction: only rows still missing a token are targeted, so re-clicking the
// button never re-emails anyone.
export const POST = withAdminAuth<{ id: string }>(async (_req, ctx, { id: evenementId }) => {
  const { associationId, userId } = ctx

  const evenement = await prisma.evenement.findFirst({ where: { id: evenementId, associationId } })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })

  // Pointless once the event is over — same end definition as the check-in window
  // (endDate, or start + 24h when none is set).
  const eventEnd = evenement.endDate ?? new Date(evenement.date.getTime() + 24 * 3_600_000)
  if (eventEnd < new Date()) {
    return NextResponse.json({ error: "L'événement est déjà terminé." }, { status: 422 })
  }

  // Valid seats only (paid, or confirmed RSVP for free ones) — a cancelled registration
  // keeps its row but loses both, and must not be handed a working entry QR.
  const rows = await prisma.participation.findMany({
    where: {
      evenementId,
      ticketToken: null,
      email: { not: null },
      OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }],
    },
    select: { id: true, firstName: true, email: true, membreId: true },
  })
  if (rows.length === 0) return NextResponse.json({ sent: 0, failed: 0 })

  const assoc = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { name: true, plan: true, customBrandingEnabled: true, logoUrl: true },
  })
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  // Tokens are committed before any email goes out — a send failure must leave a row
  // whose QR (if the email did sneak out) still resolves, never the reverse.
  const tokens = new Map(rows.map(r => [r.id, randomBytes(20).toString("hex")]))
  await prisma.$transaction(rows.map(r =>
    prisma.participation.update({ where: { id: r.id }, data: { ticketToken: tokens.get(r.id)! } }),
  ))

  const branding = resolveDocumentBranding(assoc)
  const result = await sendEmailBulk(rows.map(r => ({
    ...ticketQrDeliveryEmail({
      firstName:       r.firstName,
      email:           r.email!,
      associationName: assoc.name,
      eventTitle:      evenement.title,
      eventDate:       evenement.date,
      eventLocation:   evenement.location,
      ticketQr: {
        imageUrl: `${APP_URL}/api/public/billet/${tokens.get(r.id)}/qr`,
        pageUrl:  `${APP_URL}/billet/${tokens.get(r.id)}`,
      },
      branding,
    }),
    context: { associationId, membreId: r.membreId ?? undefined, source: "TICKET_QR_RESEND", sourceId: r.id },
  })))

  // A failed send never went out (no Resend id — see sendEmailBatch), so dropping the
  // failed rows' fresh tokens is safe and puts them back in this endpoint's target set:
  // re-clicking the button retries exactly the attendees who got nothing.
  if (result.failed > 0) {
    const failedSet = new Set(result.failedRecipients)
    const failedIds = rows.filter(r => failedSet.has(r.email!)).map(r => r.id)
    await prisma.participation.updateMany({
      where: { id: { in: failedIds } },
      data:  { ticketToken: null },
    }).catch(() => {})
  }

  await writeActivityLog({
    associationId, actorId: userId, action: "TICKET_QR_EMAILS_SENT",
    entity: "Evenement", entityId: evenementId, label: evenement.title,
    metadata: { sent: result.sent, failed: result.failed },
  })

  return NextResponse.json({ sent: result.sent, failed: result.failed })
}, { roles: MANAGERS })
