import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { anonymizeMembre } from "@/lib/gdpr/anonymize"
import { sendEmail } from "@/lib/mail"
import { erasureRequestCompletedEmail } from "@/lib/email"
import { resolveEmailBranding } from "@/lib/plan-limits"
import { reportError } from "@/lib/monitoring"
import { assertCanDeactivateAdministrator } from "@/lib/team-access"
import { notifyAdministratorsOfErasureRequest } from "@/lib/gdpr/erasure-notify"

// RGPD Art. 17 (security audit H6, step 3) — nightly sweep that actually performs the
// erasure for every ErasureRequest sitting at PENDING. HELD rows are deliberately skipped
// (that's the whole point of a legal hold); REVIEW rows are skipped too since nothing has
// approved them yet. A failed attempt stays PENDING so the next run retries it — retryCount/
// lastError exist purely for visibility into a request that keeps failing, there's no cap:
// an erasure obligation doesn't expire just because it's been hard to execute.
// Vercel Cron always invokes the configured path with GET — see membre-control-alert-sweep
// for the same note. POST is also exported so a manual curl during development still works.
async function handler(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("[cron/erasure-request-sweep] CRON_SECRET is not configured — refusing to run")
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const pending = await prisma.erasureRequest.findMany({
    where:  { status: "PENDING" },
    select: { id: true, associationId: true, membreId: true },
  })

  let processed = 0
  let failed = 0

  for (const request of pending) {
    try {
      // Captured before anonymizeMembre runs — it nulls Membre.email, so this is the data
      // subject's last reachable address for the completion notice below.
      const [membreBefore, association] = await Promise.all([
        prisma.membre.findUnique({ where: { id: request.membreId }, select: { email: true, userId: true, firstName: true, lastName: true } }),
        prisma.association.findUnique({ where: { id: request.associationId }, select: { name: true } }),
      ])

      // Re-checked here, not just at creation time (POST /api/erasure-requests) — the admin
      // roster can change during the days a request sits PENDING or comes off a HELD, and this
      // call is what actually deactivates the linked User below. Left PENDING, not failed: the
      // situation can resolve itself (another admin added) and the next night's run retries on
      // its own, same as any other failure path here.
      if (membreBefore?.userId) {
        const refusal = await assertCanDeactivateAdministrator(request.associationId, membreBefore.userId)
        if (refusal) throw new Error(refusal.error)
      }

      // null membre (already gone, e.g. hard-deleted by some other path) still counts as
      // "nothing left to erase" — mark it PROCESSED rather than retrying forever on a target
      // that will never come back.
      await anonymizeMembre(request.associationId, request.membreId, null)
      await prisma.erasureRequest.update({
        where: { id: request.id },
        data:  { status: "PROCESSED", processedAt: new Date(), lastError: null },
      })
      processed++

      if (membreBefore?.email && association) {
        try {
          await sendEmail(erasureRequestCompletedEmail({
            to:              membreBefore.email,
            associationName: association.name,
            branding:        await resolveEmailBranding(request.associationId),
          }), { associationId: request.associationId, membreId: request.membreId, source: "ERASURE_REQUEST", sourceId: request.id })
        } catch (emailError) {
          // The erasure itself already succeeded and is marked PROCESSED above — a failed
          // notification must not look like a failed erasure (no retry, no status change).
          reportError(emailError, { area: "email", action: "erasure-request.completed-email", extra: { associationId: request.associationId, membreId: request.membreId } })
        }
      }

      if (membreBefore) {
        // No excludeUserId: this is the automated cron, not an action any one admin just took.
        notifyAdministratorsOfErasureRequest({
          associationId:    request.associationId,
          erasureRequestId: request.id,
          membreId:         request.membreId,
          membreName:       `${membreBefore.firstName} ${membreBefore.lastName}`,
          event:            "completed",
        })
      }
    } catch (error) {
      failed++
      const message = error instanceof Error ? error.message : String(error)
      await prisma.erasureRequest.update({
        where: { id: request.id },
        data:  { retryCount: { increment: 1 }, lastError: message },
      })
      reportError(error, {
        area:  "cron",
        action: "erasure-request-sweep.anonymize",
        extra: { erasureRequestId: request.id, associationId: request.associationId, membreId: request.membreId },
      })
    }
  }

  return NextResponse.json({ processed, failed })
}

export const GET = handler
export const POST = handler
