// FORM-114: decides, from a tier's federative-license config and the visitor's own choice on
// the public form (or the registrant payload in the admin API, same shape), whether a
// MembershipLicense record should be created for this Cotisation and whether the tier's
// licenseAdditionalAmount is actually owed. Shared by the free/offline checkout branches
// (which call this directly) and the Stripe branches (which snapshot its result onto
// Checkout/Subscription metadata — see checkout/route.ts — since the webhooks that actually
// create the Cotisation never see the original request payload).
export type MembershipLicenseTierConfig = {
  licenseEnabled: boolean
  licenseMandatory: boolean
  licenseAllowDeclareExisting: boolean
  licenseFederation: string | null
  licenseSeason: string | null
  licenseBillingMode: "INCLUDED" | "ADDITIONAL" | null
}

export type MembershipLicenseInput = {
  licenseOptIn?: boolean
  licenseDeclaredExisting?: boolean
  licenseNumber?: string
}

export type MembershipLicenseApplication = {
  federation: string
  season: string
  declaredByMembre: boolean
  licenseNumber: string | null
  // Whether MembershipTier.licenseAdditionalAmount is actually owed for this signup — false
  // for an INCLUDED tier (already folded into the tier's own price) and for a declared
  // existing license (see MembershipTier.licenseAllowDeclareExisting).
  chargeAmount: boolean
}

export function resolveLicenseApplication(
  tier: MembershipLicenseTierConfig,
  input: MembershipLicenseInput,
): MembershipLicenseApplication | null {
  // A tier without a configured federation/season can't produce a meaningful record even if
  // licenseEnabled is somehow still set (e.g. a half-finished config) — same defensive floor
  // as requiring both fields at save time (see the tiers API route's zod refinement).
  if (!tier.licenseEnabled || !tier.licenseFederation || !tier.licenseSeason) return null

  const declaredByMembre = !!input.licenseDeclaredExisting && tier.licenseAllowDeclareExisting
  const applies = tier.licenseMandatory || !!input.licenseOptIn || declaredByMembre
  if (!applies) return null

  return {
    federation: tier.licenseFederation,
    season: tier.licenseSeason,
    declaredByMembre,
    licenseNumber: input.licenseNumber?.trim() || null,
    chargeAmount: tier.licenseBillingMode === "ADDITIONAL" && !declaredByMembre,
  }
}
