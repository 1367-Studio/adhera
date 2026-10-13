import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { Prisma } from "@prisma/client"

// RGPD/CNIL compliance (security audit M3) — ActivityLog had no retention limit at all, in
// violation of the "limitation de conservation" principle. CNIL deliberation n°2021-122
// (14 oct. 2021) recommends keeping traceability logs for 6 months to 1 year on a rolling
// basis, extendable to up to 3 years only when justified by a specific access-control need —
// none is identified here, so this uses the standard 1-year ceiling.
// Mirrors purge-email-html: the row itself (action/entity/entityId/actorId/createdAt) stays,
// since that skeleton is what makes the audit trail still useful in aggregate — only the
// personal-data-bearing content (free-text label, metadata diffs that often embed real
// names/emails) is cleared.
const RETENTION_DAYS = 365

// Vercel Cron always invokes the configured path with GET — see membre-control-alert-sweep
// for the same note. POST is also exported so a manual curl during development still works.
async function handler(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("[cron/activity-log-retention-sweep] CRON_SECRET is not configured — refusing to run")
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)

  const { count } = await prisma.activityLog.updateMany({
    where: {
      createdAt: { lt: cutoff },
      OR: [{ metadata: { not: Prisma.DbNull } }, { label: { not: null } }],
    },
    data: { metadata: Prisma.DbNull, label: null },
  })

  return NextResponse.json({ anonymized: count })
}

export const GET = handler
export const POST = handler
