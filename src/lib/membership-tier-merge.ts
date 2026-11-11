import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"

export type MergeMembershipTiersResult = { relationCounts: Record<string, number> }

export class MergeMembershipTiersError extends Error {
  status: number
  constructor(message: string, status = 422) {
    super(message)
    this.status = status
  }
}

type MergeMembershipTiersInput = {
  associationId:   string
  primaryTierId:   string
  secondaryTierId: string
  performedById:   string
}

// Reassigns every table that references a MembershipTier from the secondary tier onto the
// primary, then archives the secondary (archivedAt) — never hard-deleted, since
// MembershipAddonPurchase.tierId is onDelete: Cascade and non-nullable (see schema.prisma
// comment on MembershipTier.archivedAt): a real delete would destroy its purchase history.
// Unlike mergeMembres (src/lib/membre-merge.ts), no FK referencing MembershipTier participates
// in a @@unique constraint, so a reassignment can never collide — no conflicts array, no
// per-relation conflict-detection pass needed, every relation is a plain bulk updateMany.
export async function mergeMembershipTiers(input: MergeMembershipTiersInput): Promise<MergeMembershipTiersResult> {
  const { associationId, primaryTierId, secondaryTierId, performedById } = input

  if (primaryTierId === secondaryTierId) {
    throw new MergeMembershipTiersError("Impossible de fusionner une catégorie avec elle-même")
  }

  const [primary, secondary] = await Promise.all([
    prisma.membershipTier.findFirst({ where: { id: primaryTierId, archivedAt: null, form: { associationId } } }),
    prisma.membershipTier.findFirst({ where: { id: secondaryTierId, archivedAt: null, form: { associationId } } }),
  ])
  if (!primary)   throw new MergeMembershipTiersError("Catégorie principale introuvable", 404)
  if (!secondary) throw new MergeMembershipTiersError("Catégorie secondaire introuvable", 404)

  const relationCounts: Record<string, number> = {}

  await prisma.$transaction(async (tx) => {
    const plainRelations: { model: "cotisation" | "cotisationSubscription" | "membershipAddonPurchase" | "membre"; field: string; label: string }[] = [
      { model: "cotisation",              field: "tierId",        label: "cotisations" },
      { model: "cotisationSubscription",  field: "tierId",        label: "subscriptions" },
      { model: "membershipAddonPurchase", field: "tierId",        label: "addonPurchases" },
      { model: "membre",                  field: "pendingTierId", label: "pendingMembres" },
    ]
    for (const { model, field, label } of plainRelations) {
      const { count } = await (tx[model] as { updateMany: (args: unknown) => Promise<{ count: number }> }).updateMany({
        where: { [field]: secondaryTierId },
        data:  { [field]: primaryTierId },
      })
      if (count > 0) relationCounts[label] = count
    }

    // Don.membershipAddonTierId — different field name, can't share the generic loop above.
    const { count: donCount } = await tx.don.updateMany({
      where: { membershipAddonTierId: secondaryTierId },
      data:  { membershipAddonTierId: primaryTierId },
    })
    if (donCount > 0) relationCounts.dons = donCount

    await tx.membershipTier.update({ where: { id: secondaryTierId }, data: { archivedAt: new Date() } })

    await tx.membershipTierMergeLog.create({
      data: {
        associationId, primaryTierId, secondaryTierId, performedById,
        relationCounts: relationCounts as Prisma.InputJsonValue,
      },
    })
  }, {
    // Same reasoning as mergeMembres's own 20s override — default 5s leaves no headroom once
    // pooler latency is added on top of several sequential updateMany round-trips.
    timeout: 20_000,
  })

  await writeActivityLog({
    associationId, actorId: performedById, action: "MEMBERSHIP_TIER_MERGED", entity: "MembershipTier", entityId: primaryTierId,
    label:    primary.label,
    metadata: { secondaryTierId, secondaryLabel: secondary.label, relationCounts },
  })

  return { relationCounts }
}
