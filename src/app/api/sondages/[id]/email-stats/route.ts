import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import type { EmailStatus } from "@prisma/client"

const MANAGERS = ["ADMIN", "PRESIDENT", "SECRETAIRE"]

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  if (!MANAGERS.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const sondage = await prisma.sondage.findFirst({
    where:   { id, associationId: ctx.associationId },
    include: { recipients: { select: { membreId: true } } },
  })
  if (!sondage) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const emails = await prisma.emailMessage.findMany({
    where:   { source: "SONDAGE", sourceId: id },
    select:  {
      status: true, to: true, errorMessage: true, sentAt: true, openedAt: true, bouncedAt: true,
      membre: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { sentAt: "desc" },
  })

  const counts: Record<EmailStatus, number> = {
    QUEUED: 0, SENT: 0, DELIVERED: 0, OPENED: 0, CLICKED: 0, BOUNCED: 0, COMPLAINED: 0, DELAYED: 0, FAILED: 0,
  }
  for (const e of emails) counts[e.status]++

  // Re-derive the sondage's *current* intended audience (same rule as activate/route.ts)
  // and diff it against who actually has an EmailMessage row — a member with no address on
  // file, or no portal account, is otherwise invisible here even though they never got an
  // invitation at all. This is live (not a snapshot from send time), so it also surfaces
  // members added to a SELECTED list who haven't been notified yet.
  let audienceIds: string[]
  if (sondage.recipientMode === "ALL") {
    const membres = await prisma.membre.findMany({
      where:  { associationId: ctx.associationId, deletedAt: null, status: "ACTIF" },
      select: { id: true },
    })
    audienceIds = membres.map(m => m.id)
  } else {
    audienceIds = sondage.recipients.map(r => r.membreId)
  }

  const emailedMembreIds = new Set(emails.map(e => e.membre?.id).filter((v): v is string => !!v))
  const notEmailed = await prisma.membre.findMany({
    where:  { id: { in: audienceIds.filter(mid => !emailedMembreIds.has(mid)) } },
    select: { id: true, firstName: true, lastName: true, email: true, userId: true },
  })
  const skippedNoEmail  = notEmailed.filter(m => m.userId && !m.email)
  const skippedNoAccess = notEmailed.filter(m => !m.userId)

  return NextResponse.json({
    total:     emails.length,
    counts,
    recipients: emails.map(e => ({
      membreId:     e.membre?.id ?? null,
      name:         e.membre ? `${e.membre.firstName} ${e.membre.lastName}` : null,
      to:           e.to,
      status:       e.status,
      errorMessage: e.errorMessage,
      sentAt:       e.sentAt,
      openedAt:     e.openedAt,
      bouncedAt:    e.bouncedAt,
    })),
    skippedNoEmail:  skippedNoEmail.map(m => ({ id: m.id, name: `${m.firstName} ${m.lastName}` })),
    skippedNoAccess: skippedNoAccess.length,
  })
})
