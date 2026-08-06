import { inngest } from "@/lib/inngest"
import { claimDueAutomationRules } from "@/lib/automation-processor"

// Same schedule as the legacy Vercel cron (vercel.json) — both run in parallel during
// cutover. claimDueAutomationRules' CAS on nextRunAt means only one of the two ever wins
// a given rule, so racing them side by side is safe and is in fact the point: it proves
// this path is a drop-in replacement before the old route gets deleted.
export const automationSweep = inngest.createFunction(
  { id: "automation-sweep", triggers: { cron: "0 9 * * *" } },
  async ({ step }) => {
    const claimed = await step.run("claim-due-rules", async () => {
      const rules = await claimDueAutomationRules(new Date())
      return rules.map(rule => ({ ruleId: rule.id, associationId: rule.associationId }))
    })

    if (claimed.length > 0) {
      await step.sendEvent("fan-out-rules", claimed.map(rule => ({
        name: "automation/rule.triggered",
        data: rule,
      })))
    }

    return { claimed: claimed.length }
  },
)
