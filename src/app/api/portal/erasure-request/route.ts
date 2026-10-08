import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"
import { writeActivityLog } from "@/lib/activity-log"
import { sendEmail } from "@/lib/mail"
import { erasureRequestReceivedEmail } from "@/lib/email"
import { resolveEmailBranding } from "@/lib/plan-limits"
import { reportError } from "@/lib/monitoring"
import { notifyAdministratorsOfErasureRequest } from "@/lib/gdpr/erasure-notify"

// RGPD Art. 17 (security audit H6) — the self-service counterpart to POST
// /api/erasure-requests: a member asking for their own erasure from the portal, instead of
// an admin registering it on their behalf. Created as REVIEW rather than PENDING — unlike an
// admin who already made a deliberate call, a member hitting this button hasn't been checked
// against assertCanDeactivateAdministrator yet (they might be the association's last admin),
// so an administrator must look at it and explicitly approve it (PATCH .../[id] { approve }
// in src/app/api/erasure-requests/[id]/route.ts) before it ever reaches the nightly cron.
const ACTIVE_STATUSES = ["REVIEW", "PENDING", "HELD"] as const

export const GET = withPortalAuth(async (_req, ctx) => {
  // Scoped to the active statuses, not "whatever is most recent" — a PROCESSED row is kept
  // forever as history (see the ErasureRequest model comment in schema.prisma), but if this
  // membre is somehow back on the portal after that (e.g. an admin manually restored them),
  // that old row must not permanently read as "you already have a request" and hide the
  // button for good. Nothing here ever creates a second REVIEW/PENDING/HELD row for the same
  // membre anyway (ACTIVE_STATUSES below + the partial unique index), so at most one can match.
  const request = await prisma.erasureRequest.findFirst({
    where:   { membreId: ctx.membreId!, status: { in: [...ACTIVE_STATUSES] } },
    orderBy: { requestedAt: "desc" },
  })
  return NextResponse.json(request)
})

export const POST = withPortalAuth(async (_req, ctx) => {
  const membre = await prisma.membre.findUnique({
    where:  { id: ctx.membreId! },
    select: { email: true, firstName: true, lastName: true },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  const existingActive = await prisma.erasureRequest.findFirst({
    where: { membreId: ctx.membreId!, status: { in: [...ACTIVE_STATUSES] } },
  })
  if (existingActive) {
    return NextResponse.json({ error: "Une demande d'effacement est déjà en cours" }, { status: 409 })
  }

  let created
  try {
    created = await prisma.erasureRequest.create({
      data: { associationId: ctx.associationId, membreId: ctx.membreId!, requestedById: ctx.userId, status: "REVIEW" },
    })
  } catch (err) {
    // Same TOCTOU window as the admin route's POST — closed by the same partial unique index
    // (migration 20261007170500_erasure_request_active_unique).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "Une demande d'effacement est déjà en cours" }, { status: 409 })
    }
    throw err
  }

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "ERASURE_REQUEST_CREATED",
    entity:        "Membre",
    entityId:      ctx.membreId!,
  })

  if (membre.email) {
    const association = await prisma.association.findUnique({ where: { id: ctx.associationId }, select: { name: true } })
    if (association) {
      sendEmail(erasureRequestReceivedEmail({
        to:              membre.email,
        associationName: association.name,
        branding:        await resolveEmailBranding(ctx.associationId),
      }), { associationId: ctx.associationId, membreId: ctx.membreId!, source: "ERASURE_REQUEST", sourceId: created.id })
        .catch((error: unknown) => reportError(error, { area: "email", action: "erasure-request.received-email", extra: { associationId: ctx.associationId, membreId: ctx.membreId } }))
    }
  }

  // No excludeUserId: the actor is the member's own portal account, not one of the
  // association's administrators, so nobody on the admin side already knows about this.
  notifyAdministratorsOfErasureRequest({
    associationId:    ctx.associationId,
    erasureRequestId: created.id,
    membreId:         ctx.membreId!,
    membreName:       `${membre.firstName} ${membre.lastName}`,
    event:            "review_requested",
  })

  return NextResponse.json(created, { status: 201 })
})

// Lets a member retract their own request while it's still unreviewed — once an admin has
// approved it (PENDING) or placed it on hold, withdrawing is an admin-only action again
// (DELETE /api/erasure-requests/[id]) since by then someone on the association side is
// already acting on it.
export const DELETE = withPortalAuth(async (_req, ctx) => {
  const existing = await prisma.erasureRequest.findFirst({
    where: { membreId: ctx.membreId!, status: "REVIEW" },
  })
  if (!existing) return NextResponse.json({ error: "Aucune demande à retirer" }, { status: 404 })

  await prisma.erasureRequest.delete({ where: { id: existing.id } })
  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "ERASURE_REQUEST_CANCELLED",
    entity:        "Membre",
    entityId:      ctx.membreId!,
  })

  const membre = await prisma.membre.findUnique({
    where:  { id: ctx.membreId! },
    select: { firstName: true, lastName: true },
  })
  // No member-facing email — they're the one acting, live, and already see it disappear from
  // their own screen. Other admins still need telling: one of them might be mid-review of a
  // request that just vanished from the queue.
  if (membre) {
    notifyAdministratorsOfErasureRequest({
      associationId:    ctx.associationId,
      erasureRequestId: existing.id,
      membreId:         ctx.membreId!,
      membreName:       `${membre.firstName} ${membre.lastName}`,
      event:            "cancelled",
    })
  }

  return NextResponse.json({ success: true })
})
