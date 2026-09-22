import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { checkAndUpdateCustomDomainStatus } from "@/lib/vercel-domains"

// Re-checks every association stuck on PENDING against the Vercel Domains API, so
// "Ativo" shows up in Paramètres a few minutes after the admin's DNS propagates without
// them ever needing to click "Verificar agora". 15 minutes (vs. the other sweeps' daily
// cadence) because the admin is actively waiting to see this flip — confirm the team's
// Vercel plan allows this frequency before relying on it in production.
export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("[cron/custom-domain-verification-sweep] CRON_SECRET is not configured — refusing to run")
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const pending = await prisma.association.findMany({
    where:  { customDomainStatus: "PENDING" },
    select: { id: true },
  })

  let checked = 0
  let failed  = 0
  for (const association of pending) {
    try {
      await checkAndUpdateCustomDomainStatus(association.id)
      checked++
    } catch (err) {
      failed++
      console.error(`[cron/custom-domain-verification-sweep] failed for association ${association.id}:`, err)
    }
  }

  return NextResponse.json({ checked, failed })
}
