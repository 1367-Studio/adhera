import { NextResponse } from "next/server"
import { claimDueAutomationRules, processRule } from "@/lib/automation-processor"
import { reportError } from "@/lib/monitoring"

// Vercel Cron always invokes the configured path with GET, not POST — this must export a GET
// handler or the schedule silently 405s on every tick (POST kept for manual curl testing).
async function handler(req: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    console.error("[cron/automations] CRON_SECRET is not configured — refusing to run")
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 })
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const now = new Date()
  let totalSent = 0

  const rules = await claimDueAutomationRules(now)

  for (const rule of rules) {
    try {
      totalSent += await processRule(rule, now)
    } catch (error) {
      reportError(error, { area: "cron", action: "cron.automations", extra: { automationRuleId: rule.id } })
    }
  }

  return NextResponse.json({ ok: true, processed: rules.length, totalSent })
}

export const GET = handler
export const POST = handler
