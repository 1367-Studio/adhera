import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { ANONYMIZED } from "@/lib/gdpr/anonymize"
import { reportError } from "@/lib/monitoring"
import { notifyAdministratorsOfErasureRequest } from "@/lib/gdpr/erasure-notify"

// RGPD Art. 17 (security audit H6, retention-policy follow-up) — until now, erasure only ever
// happened when an admin or the member themselves asked for it; nothing enforced the actual
// retention rule the CNIL recommends for an ended association relationship: keep data while
// the membership lasts, then at most 3 years after the last active contact, anonymize.
//
// "Last active contact" is read as Membre.deletedAt here, not e.g. the last paid Cotisation —
// bénévoles routinely have no Cotisation at all, so "no payment in 3 years" would misfire on
// a perfectly active volunteer. deletedAt is the explicit, deliberate signal an admin already
// gives via the ordinary delete flow (DELETE /api/membres/[id]) that the relationship is over.
//
// Creates a REVIEW request (not PENDING) — same caution as the member's own self-service
// path (POST /api/portal/erasure-request): nobody has made a deliberate per-member decision
// here either, including the last-administrator check, so a human must look at each one
// before it can reach the nightly erasure-request-sweep cron that actually anonymizes.
const RETENTION_YEARS = 3

// Vercel Cron always invokes the configured path with GET — see membre-control-alert-sweep
// for the same note. POST is also exported so a manual curl during development still works.
async function handler(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("[cron/erasure-retention-sweep] CRON_SECRET is not configured — refusing to run")
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - RETENTION_YEARS)

  const eligible = await prisma.membre.findMany({
    where: {
      deletedAt:       { not: null, lt: cutoff },
      firstName:       { not: ANONYMIZED },
      erasureRequests: { none: { status: { in: ["REVIEW", "PENDING", "HELD"] } } },
    },
    select: { id: true, associationId: true, firstName: true, lastName: true },
  })

  let flagged = 0

  for (const membre of eligible) {
    try {
      const created = await prisma.erasureRequest.create({
        data: { associationId: membre.associationId, membreId: membre.id, requestedById: null, status: "REVIEW" },
      })
      flagged++
      notifyAdministratorsOfErasureRequest({
        associationId:    membre.associationId,
        erasureRequestId: created.id,
        membreId:         membre.id,
        membreName:       `${membre.firstName} ${membre.lastName}`,
        event:            "retention_triggered",
      })
    } catch (error) {
      // The `erasureRequests: { none: ... } }` filter above and this create() are two separate
      // statements — same TOCTOU window as every other creation path in this feature, closed
      // by the same partial unique index (migration 20261007170500_erasure_request_active_unique).
      // A collision here just means some other path already flagged this membre moments ago —
      // not a real failure worth retrying, so it's reported and skipped rather than retried.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") continue
      reportError(error, { area: "cron", action: "erasure-retention-sweep.create", extra: { associationId: membre.associationId, membreId: membre.id } })
    }
  }

  return NextResponse.json({ flagged })
}

export const GET = handler
export const POST = handler
