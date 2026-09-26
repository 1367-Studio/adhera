import { NextResponse } from "next/server"
import { claimDueAutomationRules, processRule } from "@/lib/automation-processor"
import { reportError } from "@/lib/monitoring"

export async function POST(req: Request) {
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
