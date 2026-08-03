import { z } from "zod"

export const CANCEL_REASONS = [
  "PRICE", "MISSING_FEATURES", "ASSOCIATION_INACTIVE", "SWITCHING_TOOL", "HARD_TO_USE", "OTHER",
] as const

// Messages default to French (server-side convention — see other schemas in this
// directory); the client overrides them with translated copy via useTranslations.
export function buildCancelSubscriptionSchema(messages?: { reasonRequired?: string; feedbackRequired?: string }) {
  return z.object({
    reason:   z.enum(CANCEL_REASONS, { message: messages?.reasonRequired ?? "Motif requis" }),
    feedback: z.string().trim().max(1000).optional(),
  }).refine(
    (data) => data.reason !== "OTHER" || !!data.feedback?.length,
    { message: messages?.feedbackRequired ?? "Feedback requis pour le motif \"Autre\"", path: ["feedback"] },
  )
}

export const cancelSubscriptionSchema = buildCancelSubscriptionSchema()

export type CancelSubscriptionInput = z.infer<typeof cancelSubscriptionSchema>
