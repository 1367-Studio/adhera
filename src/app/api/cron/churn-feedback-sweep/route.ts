import { randomBytes } from "crypto"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { churnFeedbackRequestEmail } from "@/lib/email"
import { CHURN_REASONS } from "@/lib/churn-feedback-reasons"
import { APP_URL } from "@/lib/env"
import { reportError } from "@/lib/monitoring"

// FORM-132 — the churn counterpart to FORM-130's stalled-signup-nudge-sweep: instead of
// nudging during the trial, this asks why *after* a subscription has already ended, once
// there's nothing left to save. Vercel Cron always invokes the configured path with GET —
// this must stay a GET handler or the schedule silently 405s on every tick. POST is also
// exported for manual curl testing.

const MS_DAY     = 24 * 60 * 60 * 1000
const WAIT_DAYS  = 5

async function billingAdmins(associationId: string) {
  return prisma.user.findMany({
    where:  { associationId, role: { in: ["ADMIN", "PRESIDENT"] }, active: true },
    select: { id: true, email: true },
  })
}

async function handler(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("[cron/churn-feedback-sweep] CRON_SECRET is not configured — refusing to run")
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - WAIT_DAYS * MS_DAY)

  const candidates = await prisma.association.findMany({
    where: {
      subscriptionStatus:      "CANCELLED",
      subscriptionCancelledAt: { lte: cutoff },
      churnFeedback:           null,
    },
    select: { id: true, name: true },
  })

  let sent = 0
  for (const assoc of candidates) {
    const admins = await billingAdmins(assoc.id)
    if (!admins.length) continue

    const token = randomBytes(20).toString("hex")
    // Created before sending, not after — its mere existence is the dedupe this sweep
    // relies on, so a crash mid-send (provider outage) never resends tomorrow with a 2nd
    // token. The unique constraint on associationId also protects against two overlapping
    // invocations both picking up the same candidate.
    try {
      await prisma.churnFeedback.create({ data: { associationId: assoc.id, token } })
    } catch {
      continue
    }

    // Each link points at the public page, which shows a "Did you mean X?" confirmation
    // step before writing anything — see src/app/churn-feedback/[token]/page.tsx and the
    // route's own comment for why the write waits for an explicit click instead of firing
    // the moment the page loads.
    const reasons = CHURN_REASONS.map(r => ({
      label: r.label,
      url:   `${APP_URL}/churn-feedback/${token}?reason=${r.code}`,
    }))
    const writeInUrl = `${APP_URL}/churn-feedback/${token}`

    for (const admin of admins) {
      if (!admin.email) continue
      await sendEmail(
        churnFeedbackRequestEmail({ email: admin.email, associationName: assoc.name, reasons, writeInUrl }),
        { associationId: assoc.id, source: "CHURN_FEEDBACK_REQUEST", sourceId: assoc.id },
      ).catch(error => reportError(error, { area: "email", action: "cron.churn-feedback-sweep", extra: { associationId: assoc.id } }))
    }
    sent++
  }

  return NextResponse.json({ sent })
}

export const GET = handler
export const POST = handler
