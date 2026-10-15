import type { Prisma, DonPaymentMethod } from "@prisma/client"

type TxClient = Prisma.TransactionClient

export interface ResolvedEvenementDonation {
  ticketTypeId: string
  label:        string
  amount:       number
  receiptMode:  "NONE" | "FULL" // never PARTIAL for a DONATION tarif — see evenement.ts's schema refine
}

// Mirrors the shape stashed in the Stripe checkout session's metadata (inscription/route.ts)
// — parsed once here rather than trusting the JSON shape at each call site.
export function parseEvenementDonations(json: string | undefined): ResolvedEvenementDonation[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export interface CreatedEvenementDonation {
  id:            string
  amount:        number
  paymentMethod: DonPaymentMethod
  paidAt:        Date | null
}

// Turns a paid/offline event registration's resolved donation extra(s) into real Don rows —
// mirror of createMembershipAddonPurchases's DONATION branch (src/lib/webhook/
// membership-addons.ts), adapted to EvenementTicketType.itemType == DONATION instead of
// MembershipTier. Called from inside the same transaction that creates/confirms the
// Participation, so a mid-way failure rolls back the whole registration instead of leaving
// an orphaned donation. Returns every row it created so the caller can notify
// Association.donResponsable (see notifyDonResponsable) only once the transaction has
// actually committed — same reasoning as createMembershipAddonPurchases's return value.
export async function createEvenementDonation(tx: TxClient, params: {
  associationId: string
  firstName:     string
  lastName:      string
  email:         string
  donations:     ResolvedEvenementDonation[]
  canIssueTaxReceipts: boolean
  // Defaults reproduce the Stripe-webhook behavior unchanged — only the offline registration
  // branch (inscription/route.ts) passes these explicitly, since there the don is created
  // before the visitor's cash/cheque/virement has actually been encaissé.
  donPaymentMethod?: DonPaymentMethod
  donPaidAt?:        Date | null
}): Promise<CreatedEvenementDonation[]> {
  const createdDonations: CreatedEvenementDonation[] = []
  for (const donation of params.donations) {
    const paymentMethod = params.donPaymentMethod ?? "STRIPE"
    const paidAt         = params.donPaidAt === undefined ? new Date() : params.donPaidAt
    const don = await tx.don.create({
      data: {
        associationId:  params.associationId,
        donationFormId: null,
        tierId:         null,
        evenementTicketTypeId: donation.ticketTypeId,
        paymentMethod,
        donorType:      "INDIVIDUAL",
        firstName:      params.firstName,
        lastName:       params.lastName,
        email:          params.email,
        amount:         donation.amount,
        paidAt,
        // La tarif porte son propre réglage (voir evenement-ticket-types-editor.tsx) — seul le
        // droit global de l'association à émettre des reçus fiscaux peut l'écraser à NONE.
        receiptMode:      params.canIssueTaxReceipts ? donation.receiptMode : "NONE",
        deductibleAmount: null, // jamais PARTIAL pour une tarif DONATION — voir le type ci-dessus
      },
    })
    createdDonations.push({ id: don.id, amount: donation.amount, paymentMethod, paidAt })
  }
  return createdDonations
}
