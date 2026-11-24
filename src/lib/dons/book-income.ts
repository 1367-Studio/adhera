import { Prisma, type DonPaymentMethod } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { getOrCreateDefaultCategory } from "@/lib/finance/resolve-default-category"
import { resolveExerciceForDate } from "@/lib/finance/exercice"

type TxClient = Prisma.TransactionClient

// Shared by every Stripe-webhook call site that turns an embedded donation add-on (event
// registration "doação extra" / membership-signup addon) into a real Don row via
// createEvenementDonation/createMembershipAddonPurchases — those helpers only ever create the
// Don itself, mirroring an offline donation's pending shape, but a Stripe-paid add-on is
// created with paidAt already set, which means it will never pass through the normal
// pending→/api/dons/[id]/encaisser flow that books a standalone Don's Income. Without this,
// money Stripe actually captured never appears in Finances at all. Mirrors the Income shape
// the standalone-Don branch of webhook/stripe/route.ts creates for a regular donation form.
export async function bookAddonDonationIncome(tx: TxClient, params: {
  associationId: string
  donorFirstName: string
  donorLastName:  string
  donations: { id: string; amount: number; paymentMethod: DonPaymentMethod; paidAt: Date | null }[]
  reference?: string | null
}): Promise<void> {
  const paidDonations = params.donations.filter(d => d.paidAt != null)
  if (paidDonations.length === 0) return

  // Resolved via the plain `prisma` client, deliberately not `tx` — same constraint as
  // boutique/book-income.ts (see getOrCreateDefaultCategory's own doc comment): its P2002
  // race-retry re-reads with a second query that would itself fail if `tx`'s transaction was
  // already aborted by a prior statement. Called first, before any `tx` write below, so
  // nothing here risks that.
  const donCategoryId = await getOrCreateDefaultCategory(prisma, params.associationId, "dons")

  for (const don of paidDonations) {
    const paidAt    = don.paidAt!
    const exercice  = await resolveExerciceForDate(params.associationId, paidAt)
    await tx.income.create({
      data: {
        associationId: params.associationId,
        exerciceId:    exercice?.status === "OUVERT" ? exercice.id : null,
        donId:         don.id,
        categoryId:    donCategoryId,
        amount:        don.amount,
        description:   `Don de ${params.donorFirstName} ${params.donorLastName}`,
        paymentMethod: don.paymentMethod,
        source:        don.paymentMethod === "STRIPE" ? "STRIPE" : "MANUAL",
        status:        "PAID",
        date:          paidAt,
        ...(params.reference ? { reference: params.reference } : {}),
      },
    })
  }
}
