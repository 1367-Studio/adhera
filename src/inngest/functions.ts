import { automationSweep } from "@/inngest/automation-sweep"
import { processAutomationRule } from "@/inngest/process-automation-rule"
import { sendEventRuleEmail, sendEventRuleSms } from "@/inngest/event-rule-dispatch"
import { bulkSendMembresEmail, bulkSendMembresSms, bulkSendCotisationReminders, bulkSendSondageInvitations } from "@/inngest/bulk-send"
import { importMembres } from "@/inngest/membres-import"
import { eventReviewRequest } from "@/inngest/event-review-request"

export const functions = [
  automationSweep,
  processAutomationRule,
  sendEventRuleEmail,
  sendEventRuleSms,
  bulkSendMembresEmail,
  bulkSendMembresSms,
  bulkSendCotisationReminders,
  bulkSendSondageInvitations,
  importMembres,
  eventReviewRequest,
]
