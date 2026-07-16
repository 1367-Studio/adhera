import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"

// The row (status, timestamps, delivery timeline) is kept forever — only the rendered
// HTML body is cleared, since that's the part that grows unbounded (a full copy per
// recipient, never deduplicated) and is only ever needed to investigate a recent send.
const RETENTION_DAYS = 90

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("[cron/purge-email-html] CRON_SECRET is not configured — refusing to run")
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)

  const { count } = await prisma.emailMessage.updateMany({
    where: { createdAt: { lt: cutoff }, html: { not: null } },
    data:  { html: null },
  })

  return NextResponse.json({ purged: count })
}
