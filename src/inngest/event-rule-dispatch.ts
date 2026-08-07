import { inngest } from "@/lib/inngest"
import { sendEmail } from "@/lib/mail"
import { sendSms } from "@/lib/sms"

// Single-recipient sends triggered by MEMBER_CREATED/RSVP_CONFIRMED automation rules
// (see src/lib/fire-event-rule.ts). Previously these were direct sendEmail/sendSms calls
// with `.catch(() => {})` — silent, no retry. Routing them through Inngest gives them the
// same retry/durability as the bulk paths, at the cost of one extra queue hop per send.
export const sendEventRuleEmail = inngest.createFunction(
  { id: "send-event-rule-email", triggers: { event: "automation/event-rule.email-requested" } },
  async ({ event, step }) => {
    await step.run("send-email", () => sendEmail(event.data.payload, event.data.context))
  },
)

export const sendEventRuleSms = inngest.createFunction(
  { id: "send-event-rule-sms", triggers: { event: "automation/event-rule.sms-requested" } },
  async ({ event, step }) => {
    await step.run("send-sms", () => sendSms(event.data.to, event.data.body, event.data.associationId, event.data.context))
  },
)
