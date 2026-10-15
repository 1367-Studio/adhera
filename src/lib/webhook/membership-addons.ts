import type { Prisma, DonPaymentMethod } from "@prisma/client"

type TxClient = Prisma.TransactionClient

export interface ResolvedAddon {
  tierId:   string
  itemType: "ADDON" | "DONATION"
  label:    string
  amount:   number
  receiptMode:      "NONE" | "FULL" | "PARTIAL"
  deductibleAmount: number | null
}

// Mirrors the exact shape checkout/route.ts serializes into metadata.addons — parsed once
// here rather than trusting the JSON shape at each call site. Exported so the webhook
// handlers can also read {label, amount} pairs off it for membershipWelcomeEmail's own
// addons breakdown (see email.ts's addonsSentence) without re-implementing this parsing.
export function parseAddons(addonsJson: string | undefined): ResolvedAddon[] {
  if (!addonsJson) return []
  try {
    const parsed = JSON.parse(addonsJson)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export interface CreatedAddonDonation {
  id:            string
  amount:        number
  paymentMethod: DonPaymentMethod
  paidAt:        Date | null
}

// Resolves a paid MembershipForm checkout's `addons` metadata into real rows, once the
// Membre this session paid for actually exists — called from inside the same transaction
// that creates it (both the one-off and recurring checkout webhooks), so a mid-way failure
// rolls back the whole signup instead of leaving an orphaned addon purchase. Returns every
// DONATION-type row it created so the caller can notify Association.donResponsable (see
// notifyDonResponsable) once the transaction has actually committed — never from in here,
// since a mid-way failure after this call must roll back without anyone having already been
// alerted about a don that no longer exists.
export async function createMembershipAddonPurchases(tx: TxClient, params: {
  associationId: string
  membreId:      string
  cotisationId?: string | null
  firstName:     string
  lastName:      string
  email:         string
  addonsJson:    string | undefined
  canIssueTaxReceipts: boolean
  // Defaults reproduce the pre-existing Stripe-webhook behavior unchanged — only the offline
  // membership checkout branch (checkout/route.ts) passes these explicitly, since there the
  // don is created before the visitor's cash/cheque/virement has actually been encaissé.
  donPaymentMethod?: DonPaymentMethod
  donPaidAt?:        Date | null
}): Promise<CreatedAddonDonation[]> {
  const addons = parseAddons(params.addonsJson)
  const createdDonations: CreatedAddonDonation[] = []
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
      const paymentMethod = params.donPaymentMethod ?? "STRIPE"
      const paidAt         = params.donPaidAt === undefined ? new Date() : params.donPaidAt
      const don = await tx.don.create({
        data: {
          associationId:  params.associationId,
          membreId:       params.membreId,
          donationFormId: null,
          tierId:         null,
          membershipAddonTierId: addon.tierId,
          paymentMethod,
          donorType:      "INDIVIDUAL",
          firstName:      params.firstName,
          lastName:       params.lastName,
          email:          params.email,
          amount:         addon.amount,
          paidAt,
          // La tarif porte son propre réglage (voir membership-tiers-editor.tsx) — seul le
          // droit global de l'association à émettre des reçus fiscaux peut l'écraser à NONE.
          receiptMode:      params.canIssueTaxReceipts ? addon.receiptMode : "NONE",
          deductibleAmount: params.canIssueTaxReceipts && addon.receiptMode === "PARTIAL" ? addon.deductibleAmount : null,
        },
      })
      createdDonations.push({ id: don.id, amount: addon.amount, paymentMethod, paidAt })
    }
  }
  return createdDonations
}
