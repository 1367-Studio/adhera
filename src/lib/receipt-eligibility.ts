// Computes the amount that actually qualifies for a tax receipt on a PARTIAL tier, given the
// amount that was actually paid — not the tier's configured amount, since a freeAmount tier
// has no fixed amount at config time (see MembershipTier/DonationTier.ineligibleAmount in
// schema.prisma). Works identically for a fixed-amount tier, where paidAmount === tier.amount.
export function eligibleReceiptAmount(
  paidAmount: number,
  receiptMode: string,
  ineligibleAmount: number | null | undefined,
): number | null {
  if (receiptMode !== "PARTIAL" || ineligibleAmount == null) return null
  return Math.max(0, Math.round((paidAmount - ineligibleAmount) * 100) / 100)
}
