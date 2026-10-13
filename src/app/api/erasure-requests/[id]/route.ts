import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { writeActivityLog } from "@/lib/activity-log"
import { sendEmail } from "@/lib/mail"
import { erasureRequestHeldEmail, erasureRequestCancelledEmail } from "@/lib/email"
import { resolveEmailBranding } from "@/lib/plan-limits"
import { reportError } from "@/lib/monitoring"
import { assertCanDeactivateAdministrator } from "@/lib/team-access"
import { notifyAdministratorsOfErasureRequest } from "@/lib/gdpr/erasure-notify"

// Fire-and-forget, same pattern throughout this route — never blocks the state change itself
// on a mail failure. Centralized here since every branch below needs the same membre/
// association lookup to build both the member-facing and the admin-facing email.
async function notifyErasureRequestChange(opts: {
  associationId:    string
  membreId:         string
  erasureRequestId: string
  actorId:          string
  event:            "approved" | "held" | "released" | "cancelled"
  heldReason?:      string | null
  memberEmail?:     (to: string, associationName: string, branding: Awaited<ReturnType<typeof resolveEmailBranding>>) => ReturnType<typeof erasureRequestHeldEmail>
}) {
  try {
    const [membre, association] = await Promise.all([
      prisma.membre.findUnique({ where: { id: opts.membreId }, select: { email: true, firstName: true, lastName: true } }),
      prisma.association.findUnique({ where: { id: opts.associationId }, select: { name: true } }),
    ])
    if (!membre || !association) return

    if (opts.memberEmail && membre.email) {
      const branding = await resolveEmailBranding(opts.associationId)
      await sendEmail(opts.memberEmail(membre.email, association.name, branding), {
        associationId: opts.associationId, membreId: opts.membreId, source: "ERASURE_REQUEST", sourceId: opts.erasureRequestId,
      })
    }

    await notifyAdministratorsOfErasureRequest({
      associationId:    opts.associationId,
      erasureRequestId: opts.erasureRequestId,
      membreId:         opts.membreId,
      membreName:       `${membre.firstName} ${membre.lastName}`,
      event:            opts.event,
      heldReason:       opts.heldReason,
      excludeUserId:    opts.actorId,
    })
  } catch (error) {
    reportError(error, { area: "email", action: `erasure-request.${opts.event}-notification`, extra: { associationId: opts.associationId, membreId: opts.membreId } })
  }
}

const patchSchema = z.union([
  z.object({ hold: z.literal(true), reason: z.string().optional() }),
  z.object({ hold: z.literal(false) }),
  z.object({ approve: z.literal(true) }),
])

// Places or releases a legal hold, or approves a self-service REVIEW request. The step-3
// cron only ever processes PENDING rows, so HELD is enough on its own to freeze a request —
// no separate "paused" flag.
export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const existing = await prisma.erasureRequest.findFirst({ where: { id, associationId: ctx.associationId } })
  if (!existing) return NextResponse.json({ error: "Demande introuvable" }, { status: 404 })

  const parsed = patchSchema.safeParse(await req.json())
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  if ("approve" in parsed.data) {
    if (existing.status !== "REVIEW") {
      return NextResponse.json({ error: "Cette demande n'est pas en cours d'examen" }, { status: 409 })
    }
    // Deferred from the member's own POST /api/portal/erasure-request to here — a self-service
    // request isn't checked against the last-administrator guard until an admin actually
    // commits to it, since a member hitting the button has no way to know whether they're the
    // association's last admin, unlike the admin-initiated POST /api/erasure-requests which
    // checks it upfront.
    const membre = await prisma.membre.findUnique({ where: { id: existing.membreId }, select: { userId: true } })
    if (membre?.userId) {
      const refusal = await assertCanDeactivateAdministrator(ctx.associationId, membre.userId)
      if (refusal) return NextResponse.json({ error: refusal.error }, { status: refusal.status })
    }
    const updated = await prisma.erasureRequest.update({ where: { id }, data: { status: "PENDING" } })
    await writeActivityLog({
      associationId: ctx.associationId,
      actorId:       ctx.userId,
      action:        "ERASURE_REQUEST_APPROVED",
      entity:        "Membre",
      entityId:      existing.membreId,
    })
    // No member-facing email — they were already told their request was "received" at
    // submission time, and approval doesn't change what happens next from their perspective.
    notifyErasureRequestChange({
      associationId: ctx.associationId, membreId: existing.membreId, erasureRequestId: id, actorId: ctx.userId, event: "approved",
    })
    return NextResponse.json(updated)
  }

  if (parsed.data.hold) {
    if (existing.status === "HELD" || existing.status === "PROCESSED") {
      return NextResponse.json({ error: "Cette demande ne peut pas être mise en attente" }, { status: 409 })
    }
    const updated = await prisma.erasureRequest.update({
      where: { id },
      data: {
        status:         "HELD",
        heldAt:         new Date(),
        heldById:       ctx.userId,
        heldReason:     parsed.data.reason ?? null,
        heldFromStatus: existing.status,
      },
    })
    await writeActivityLog({
      associationId: ctx.associationId,
      actorId:       ctx.userId,
      action:        "ERASURE_REQUEST_HELD",
      entity:        "Membre",
      entityId:      existing.membreId,
    })
    notifyErasureRequestChange({
      associationId: ctx.associationId, membreId: existing.membreId, erasureRequestId: id, actorId: ctx.userId,
      event: "held", heldReason: parsed.data.reason ?? null,
      memberEmail: (to, associationName, branding) => erasureRequestHeldEmail({ to, associationName, branding }),
    })
    return NextResponse.json(updated)
  }

  if (existing.status !== "HELD") {
    return NextResponse.json({ error: "Cette demande n'est pas en attente" }, { status: 409 })
  }
  const updated = await prisma.erasureRequest.update({
    where: { id },
    data: {
      status:         existing.heldFromStatus ?? "PENDING",
      heldAt:         null,
      heldById:       null,
      heldReason:     null,
      heldFromStatus: null,
    },
  })
  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "ERASURE_REQUEST_HOLD_RELEASED",
    entity:        "Membre",
    entityId:      existing.membreId,
  })
  // No member-facing email on release — only the association's other admins need to know
  // the request is back on the nightly processing path; the member was already told it was
  // "received" and never heard it was paused in a way that would need a lift notice to match.
  notifyErasureRequestChange({
    associationId: ctx.associationId, membreId: existing.membreId, erasureRequestId: id, actorId: ctx.userId, event: "released",
  })
  return NextResponse.json(updated)
}, { administrator: true })

// Hard delete — a request is either never acted on, or its outcome (PROCESSED) is kept as
// permanent history and can't be cancelled away.
export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const existing = await prisma.erasureRequest.findFirst({ where: { id, associationId: ctx.associationId } })
  if (!existing) return NextResponse.json({ error: "Demande introuvable" }, { status: 404 })
  if (existing.status === "PROCESSED") {
    return NextResponse.json({ error: "Une demande déjà traitée ne peut pas être annulée" }, { status: 409 })
  }
  // requestedById null means the retention-sweep cron flagged this, not a human — cancelling
  // it would be a no-op in disguise: deleting the row doesn't change Membre.deletedAt, so the
  // very next nightly run would just re-flag the same membre into a brand-new REVIEW request,
  // while this call's member-facing "cancelled" email (below) would have already gone out for
  // a request the member never knew existed in the first place. Mettre en attente is the only
  // action that actually sticks for this origin (held requests are excluded from re-flagging).
  if (!existing.requestedById) {
    return NextResponse.json({ error: "Une demande signalée automatiquement ne peut pas être annulée — mettez-la en attente pour conserver les données." }, { status: 409 })
  }

  await prisma.erasureRequest.delete({ where: { id } })
  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "ERASURE_REQUEST_CANCELLED",
    entity:        "Membre",
    entityId:      existing.membreId,
  })
  notifyErasureRequestChange({
    associationId: ctx.associationId, membreId: existing.membreId, erasureRequestId: id, actorId: ctx.userId, event: "cancelled",
    memberEmail: (to, associationName, branding) => erasureRequestCancelledEmail({ to, associationName, branding }),
  })
  return NextResponse.json({ success: true })
}, { administrator: true })
