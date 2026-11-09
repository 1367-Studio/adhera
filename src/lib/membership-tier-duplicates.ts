import { prisma } from "@/lib/prisma/client"

export type DuplicateTierCandidate = {
  id:                     string
  label:                  string
  formId:                 string
  formTitle:              string
  kind:                   "ONE_OFF" | "RECURRING"
  amount:                 string | null
  free:                   boolean
  freeAmount:             boolean
  cotisationCount:        number
  membreCount:            number
  subscriptionCount:      number
  // Only ACTIVE/PAST_DUE — merging doesn't touch the underlying Stripe subscription's price,
  // so a tier with one of these still billing on its own original terms after the merge is
  // worth flagging in the UI (see MergeDuplicateTiersModal's subscription warning).
  activeSubscriptionCount: number
}

export type DuplicateTierGroup = {
  normalizedLabel: string
  tiers:           DuplicateTierCandidate[]
}

// Case/accents/extra-whitespace-insensitive comparison key — "Adhésion Standard" and
// "adhésion   standard" must land in the same bucket, but this is only ever used to SUGGEST a
// merge (see src/lib/membership-tier-merge.ts): identically-named tiers can legitimately serve
// different purposes, so nothing here ever merges anything on its own.
export function normalizeTierLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
}

// Groups active (non-archived) MembershipTier rows of one association by normalized label,
// across every MembershipForm it owns — the Cotisations page's "Catégorie" filter is itself
// association-wide (see /api/cotisations/tier-options), not scoped to a single form, so a
// duplicate created on two different forms is just as real a problem as one created twice on
// the same form.
export async function findDuplicateMembershipTierGroups(associationId: string): Promise<DuplicateTierGroup[]> {
  const tiers = await prisma.membershipTier.findMany({
    where:  { archivedAt: null, form: { associationId } },
    select: {
      id: true, label: true, formId: true, kind: true, amount: true, free: true, freeAmount: true,
      form: { select: { title: true } },
    },
  })

  const byNormalized = new Map<string, typeof tiers>()
  for (const tier of tiers) {
    const key = normalizeTierLabel(tier.label)
    const bucket = byNormalized.get(key)
    if (bucket) bucket.push(tier)
    else byNormalized.set(key, [tier])
  }

  const candidateGroups = [...byNormalized.entries()].filter(([, group]) => group.length > 1)
  if (candidateGroups.length === 0) return []

  const groups = await Promise.all(candidateGroups.map(async ([normalizedLabel, group]) => {
    const tierCandidates = await Promise.all(group.map(async tier => {
      const [cotisationCount, distinctMembres, subscriptionCount, activeSubscriptionCount] = await Promise.all([
        prisma.cotisation.count({ where: { tierId: tier.id } }),
        prisma.cotisation.findMany({ where: { tierId: tier.id }, distinct: ["membreId"], select: { membreId: true } }),
        prisma.cotisationSubscription.count({ where: { tierId: tier.id } }),
        prisma.cotisationSubscription.count({ where: { tierId: tier.id, status: { in: ["ACTIVE", "PAST_DUE"] } } }),
      ])
      return {
        id:                tier.id,
        label:             tier.label,
        formId:            tier.formId,
        formTitle:         tier.form.title,
        kind:              tier.kind,
        amount:            tier.amount?.toString() ?? null,
        free:              tier.free,
        freeAmount:        tier.freeAmount,
        cotisationCount,
        membreCount:       distinctMembres.length,
        subscriptionCount,
        activeSubscriptionCount,
      }
    }))
    return { normalizedLabel, tiers: tierCandidates }
  }))

  return groups.sort((a, b) => a.normalizedLabel.localeCompare(b.normalizedLabel))
}
