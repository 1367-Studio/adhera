import type { Prisma } from "@prisma/client"

type TxClient = Prisma.TransactionClient

interface ResolvedAddon {
  tierId:   string
  itemType: "ADDON" | "DONATION"
  label:    string
  amount:   number
}

// Mirrors the exact shape checkout/route.ts serializes into metadata.addons — parsed once
// here rather than trusting the JSON shape at each call site.
function parseAddons(addonsJson: string | undefined): ResolvedAddon[] {
  if (!addonsJson) return []
  try {
    const parsed = JSON.parse(addonsJson)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// Resolves a paid MembershipForm checkout's `addons` metadata into real rows, once the
// Membre this session paid for actually exists — called from inside the same transaction
// that creates it (both the one-off and recurring checkout webhooks), so a mid-way failure
// rolls back the whole signup instead of leaving an orphaned addon purchase.
export async function createMembershipAddonPurchases(tx: TxClient, params: {
  associationId: string
  membreId:      string
  cotisationId?: string | null
  firstName:     string
  lastName:      string
  email:         string
  addonsJson:    string | undefined
  canIssueTaxReceipts: boolean
}): Promise<void> {
  const addons = parseAddons(params.addonsJson)
  for (const addon of addons) {
    if (addon.itemType === "ADDON") {
      await tx.membershipAddonPurchase.create({
        data: {
          associationId: params.associationId,
          membreId:      params.membreId,
          tierId:        addon.tierId,
          cotisationId:  params.cotisationId ?? null,
          label:         addon.label,
          amount:        addon.amount,
        },
      })
    } else if (addon.itemType === "DONATION") {
      await tx.don.create({
        data: {
          associationId:  params.associationId,
          membreId:       params.membreId,
          donationFormId: null,
          tierId:         null,
          membershipAddonTierId: addon.tierId,
          paymentMethod:  "STRIPE",
          donorType:      "INDIVIDUAL",
          firstName:      params.firstName,
          lastName:       params.lastName,
          email:          params.email,
          amount:         addon.amount,
          paidAt:         new Date(),
          receiptMode:    params.canIssueTaxReceipts ? "FULL" : "NONE",
        },
      })
    }
  }
}
