import { inngest } from "@/lib/inngest"
import { prisma } from "@/lib/prisma/client"
import { automationRuleInclude, processRule } from "@/lib/automation-processor"

export const processAutomationRule = inngest.createFunction(
  {
    id: "process-automation-rule",
    triggers: { event: "automation/rule.triggered" },
    // Cap concurrent rule processing per association so a tenant with many rules due at
    // once can't starve everyone else's sends — this is the actual scaling fix phase 2
    // exists for (today's cron processes every association's rules sequentially, in one
    // long-running function with no isolation between tenants).
    concurrency: [{ key: "event.data.associationId", limit: 3 }],
  },
  async ({ event, step }) => {
    const sent = await step.run("process-rule", async () => {
      const rule = await prisma.automationRule.findUnique({
        where:   { id: event.data.ruleId },
        include: automationRuleInclude,
      })
      if (!rule) return 0
      return processRule(rule, new Date())
    })

    return { ruleId: event.data.ruleId, sent }
  },
)
