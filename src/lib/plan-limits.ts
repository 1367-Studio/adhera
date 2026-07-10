import { prisma } from "@/lib/prisma/client"
import { getPricingInfo } from "@/lib/stripe"
import type { AssociationPlan } from "@prisma/client"
import { MEMBER_LIMIT_ERROR_CODE } from "@/lib/api-error-codes"

// Message assumes an admin reading it in the dashboard, with a plan to upgrade — wrong
// tone for a stranger filling a public join-request form or a member self-registering on
// the portal. Those two call sites (src/app/api/public/[slug]/inscription/route.ts,
// src/app/api/portal/register/route.ts) catch this and show their own copy instead of
// err.message; only src/app/api/membres/route.ts (admin-facing) uses it directly.
export class MemberLimitReachedError extends Error {
  readonly code = MEMBER_LIMIT_ERROR_CODE
  constructor(public readonly limit: number) {
    super(`Limite de ${limit} membres atteinte pour votre formule. Passez à la formule supérieure.`)
    this.name = "MemberLimitReachedError"
  }
}

// Doesn't name a specific number, mention "plan"/upgrading, or imply the association chose
// to turn people away — a stranger filling a public join form has no plan to upgrade, and
// framing it as the association's own decision ("n'accepte pas") could make it look closed
// to new members over what's really just an unpaid platform limit.
export const MEMBER_LIMIT_VISITOR_MESSAGE =
  "Les inscriptions sont temporairement limitées pour cette association. Contactez-la directement pour plus d'informations."

// AssociationPlan is ESSENTIAL/PRO only — PricingInfo.plans is keyed by the lowercase
// PlanTier ("essential"/"pro") used everywhere else in the billing code. Exported for
// src/app/api/billing/reactivate/route.ts, which needs to check a *prospective* plan
// (the tier being reactivated into) against the current member count before it's committed
// to Stripe/the DB. Doesn't account for customMemberLimit on purpose — self-service
// reactivation only ever offers the two standard tiers, never a negotiated one.
export function memberLimitForPlan(plan: AssociationPlan, pricing: Awaited<ReturnType<typeof getPricingInfo>>): number {
  return plan === "PRO" ? pricing.plans.pro.memberLimit : pricing.plans.essential.memberLimit
}

// The limit actually enforced for a given association: its staff-set override (see
// Association.customMemberLimit, backoffice > association > Abonnement) when present,
// otherwise its tier's standard limit.
export function effectiveMemberLimit(
  association: { plan: AssociationPlan; customMemberLimit: number | null },
  pricing: Awaited<ReturnType<typeof getPricingInfo>>,
): number {
  return association.customMemberLimit ?? memberLimitForPlan(association.plan, pricing)
}

// Called from every member-creation path (admin-created, initial registration, public
// self-registration, portal self-registration) right before the write. Throws
// MemberLimitReachedError instead of returning a boolean so a forgotten call site fails
// loudly in review rather than silently skipping the check.
export async function assertMemberLimit(associationId: string): Promise<void> {
  const association = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { plan: true, customMemberLimit: true },
  })
  if (!association) return // caller's own lookup will 404 right after this

  const [pricing, activeCount] = await Promise.all([
    getPricingInfo(),
    prisma.membre.count({ where: { associationId, status: "ACTIF" } }),
  ])

  const limit = effectiveMemberLimit(association, pricing)
  if (activeCount >= limit) throw new MemberLimitReachedError(limit)
}
