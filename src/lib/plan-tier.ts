import type { AssociationPlan } from "@prisma/client"
import type { PlanTier } from "@/lib/stripe"

// Single mapping between the DB enum (Association.plan, PricingOffer.planTier) and the
// lowercase PlanTier keying PLAN_PRICES / PricingInfo.plans. Kept free of server imports
// (type-only) so client components can use the labels too.
const TIER_BY_PLAN: Record<AssociationPlan, PlanTier> = {
  STARTER:   "starter",
  ESSENTIAL: "essential",
  PRO:       "pro",
}

const PLAN_BY_TIER: Record<PlanTier, AssociationPlan> = {
  starter:   "STARTER",
  essential: "ESSENTIAL",
  pro:       "PRO",
}

const PLAN_LABELS: Record<AssociationPlan, string> = {
  STARTER:   "Starter",
  ESSENTIAL: "Essentiel",
  PRO:       "Pro",
}

export function planFromTier(tier: PlanTier): AssociationPlan {
  return PLAN_BY_TIER[tier]
}

export function tierFromPlan(plan: AssociationPlan): PlanTier {
  return TIER_BY_PLAN[plan]
}

export function planLabel(plan: AssociationPlan): string {
  return PLAN_LABELS[plan]
}
