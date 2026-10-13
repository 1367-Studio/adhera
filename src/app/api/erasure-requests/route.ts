import { NextResponse } from "next/server"
import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { writeActivityLog } from "@/lib/activity-log"
import { sendEmail } from "@/lib/mail"
import { erasureRequestReceivedEmail } from "@/lib/email"
import { resolveEmailBranding } from "@/lib/plan-limits"
import { reportError } from "@/lib/monitoring"
import { assertCanDeactivateAdministrator } from "@/lib/team-access"
import { notifyAdministratorsOfErasureRequest } from "@/lib/gdpr/erasure-notify"

// RGPD Art. 17 (security audit H6, step 2) — a request to actually erase one Membre's
// personal data, distinct from the plain Membre.deletedAt soft-delete used for routine
// member turnover. Nothing here calls anonymizeMembre (src/lib/gdpr/anonymize.ts) yet — that
// only happens in the step-3 nightly cron, which processes PENDING rows.
const ACTIVE_STATUSES = ["REVIEW", "PENDING", "HELD"] as const

export const GET = withAdminAuth(async (_req, ctx) => {
  const requests = await prisma.erasureRequest.findMany({
    where:   { associationId: ctx.associationId },
    include: { membre: { select: { firstName: true, lastName: true, email: true, deletedAt: true } } },
    orderBy: [{ status: "asc" }, { requestedAt: "desc" }],
  })
  return NextResponse.json(requests)
}, { administrator: true })

const postSchema = z.object({ membreId: z.string().min(1) })

export const POST = withAdminAuth(async (req, ctx) => {
  const parsed = postSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  const { membreId } = parsed.data

  const membre = await prisma.membre.findFirst({
    where:  { id: membreId, associationId: ctx.associationId },
    select: { id: true, email: true, userId: true, firstName: true, lastName: true },
  })
  if (!membre) return NextResponse.json({ error: "Membre introuvable" }, { status: 404 })

  // Same guards as DELETE /api/membres/[id] — this request is only a queued intent today, but
  // the step-3 cron eventually calls the exact same anonymizeMembre() that deactivates the
  // linked User, so it is just as real a way to lock yourself out or strip the association's
  // last administrator as a direct delete, and must not be a side door around those guards.
  if (membre.userId === ctx.userId) {
    return NextResponse.json({ error: "Vous ne pouvez pas demander l'effacement de votre propre compte" }, { status: 403 })
  }
  if (membre.userId) {
    const refusal = await assertCanDeactivateAdministrator(ctx.associationId, membre.userId)
    if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status })
  }

  const existingActive = await prisma.erasureRequest.findFirst({
    where: { membreId, status: { in: [...ACTIVE_STATUSES] } },
  })
  if (existingActive) {
    return NextResponse.json({ error: "Une demande d'effacement est déjà en cours pour ce membre" }, { status: 409 })
  }

  // Created directly as PENDING: an admin registering this is already a decision to proceed —
  // unlike POST /api/portal/erasure-request, which creates REVIEW instead since the member
  // submitting it hasn't been checked against assertCanDeactivateAdministrator below.
  let created
  try {
    created = await prisma.erasureRequest.create({
      data: { associationId: ctx.associationId, membreId, requestedById: ctx.userId, status: "PENDING" },
    })
  } catch (err) {
    // The `existingActive` check above and this create() are two separate statements — a
    // double-click or two admins acting on the same membre at once can both pass the check
    // before either row exists. The partial unique index (migration
    // 20261007170500_erasure_request_active_unique) is what actually closes that race; this
    // just turns its violation into the same friendly 409 instead of a 500.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return NextResponse.json({ error: "Une demande d'effacement est déjà en cours pour ce membre" }, { status: 409 })
    }
    throw err
  }

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "ERASURE_REQUEST_CREATED",
    entity:        "Membre",
    entityId:      membreId,
  })

  if (membre.email) {
    const association = await prisma.association.findUnique({ where: { id: ctx.associationId }, select: { name: true } })
    if (association) {
      sendEmail(erasureRequestReceivedEmail({
        to:              membre.email,
        associationName: association.name,
        branding:        await resolveEmailBranding(ctx.associationId),
      }), { associationId: ctx.associationId, membreId, source: "ERASURE_REQUEST", sourceId: created.id })
        .catch((error: unknown) => reportError(error, { area: "email", action: "erasure-request.received-email", extra: { associationId: ctx.associationId, membreId } }))
    }
  }

  notifyAdministratorsOfErasureRequest({
    associationId:    ctx.associationId,
    erasureRequestId: created.id,
    membreId,
    membreName:       `${membre.firstName} ${membre.lastName}`,
    event:            "created",
    excludeUserId:    ctx.userId,
  })

  return NextResponse.json(created, { status: 201 })
}, { administrator: true })
