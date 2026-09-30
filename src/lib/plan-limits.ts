import { prisma } from "@/lib/prisma/client"
import { getPricingInfo } from "@/lib/stripe"
import type { AssociationPlan } from "@prisma/client"
import { tierFromPlan } from "@/lib/plan-tier"
import { MEMBER_LIMIT_ERROR_CODE } from "@/lib/api-error-codes"
import { parseEmailFooterSettings, type EmailFooterSettings } from "@/lib/email-footer"

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

// PricingInfo.plans is keyed by the lowercase PlanTier (see src/lib/plan-tier.ts for the
// AssociationPlan ↔ PlanTier mapping). Starter shares Essentiel's features, only its
// member limit differs. Exported for
// src/app/api/billing/reactivate/route.ts, which needs to check a *prospective* plan
// (the tier being reactivated into) against the current member count before it's committed
// to Stripe/the DB. Doesn't account for customMemberLimit on purpose — self-service
// reactivation only ever offers the standard tiers, never a negotiated one.
export function memberLimitForPlan(plan: AssociationPlan, pricing: Awaited<ReturnType<typeof getPricingInfo>>): number {
  return pricing.plans[tierFromPlan(plan)].memberLimit
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

// Custom branding (the association's logo on the dashboard, portal, devis/facture PDFs
// and the feuille de présence — colors are always the platform defaults) defaults to Pro.
// Same override pattern as customMemberLimit: a null/false Association.customBrandingEnabled
// falls back to the plan default, true force-enables it for a specific Essentiel
// association (see backoffice > association).
export function canUseCustomBranding(association: { plan: AssociationPlan; customBrandingEnabled: boolean | null }): boolean {
  return association.customBrandingEnabled ?? association.plan === "PRO"
}

// Shared by every PDF export (devis, facture, feuille de présence) and every association-
// owned email (see EmailBranding in src/lib/email.ts) so the Pro gate can't be forgotten at
// a call site — associations without access just get the platform default look (no logo, no
// custom accent/sender/signature) instead of an error.
//
// accentColor/senderName/signatureHtml are optional on the input on purpose: most of this
// function's ~40 call sites only ever needed logoUrl (PDF generation) and select just that
// column — making the new fields required here would force selecting 3 more columns at every
// one of those, for no PDF-visible effect. Callers that build an email (and want the new
// fields to actually show up) opt in by selecting primaryColor/emailSenderName/emailSignature
// alongside logoUrl; callers that don't just get null for them, same as today.
export function resolveDocumentBranding(
  association: {
    plan:                  AssociationPlan
    customBrandingEnabled: boolean | null
    logoUrl:               string | null
    primaryColor?:         string | null
    emailSenderName?:      string | null
    emailSignature?:       string | null
    emailFooterSettings?:  unknown
  },
): { logoUrl: string | null; accentColor: string | null; senderName: string | null; signatureHtml: string | null; footer: EmailFooterSettings | null } {
  if (!canUseCustomBranding(association)) return { logoUrl: null, accentColor: null, senderName: null, signatureHtml: null, footer: null }
  return {
    logoUrl:       association.logoUrl,
    accentColor:   association.primaryColor ?? null,
    senderName:    association.emailSenderName ?? null,
    signatureHtml: association.emailSignature ?? null,
    // Parsed even when emailFooterSettings is undefined (a caller that didn't select the
    // column) — parseEmailFooterSettings(undefined) yields the same "classic, unstyled"
    // defaults as an association that opened branding settings but never touched the footer,
    // which layout() renders identically to the original hardcoded footer anyway.
    footer: "emailFooterSettings" in association ? parseEmailFooterSettings(association.emailFooterSettings) : null,
  }
}

// resolveDocumentBranding() above only reads fields already sitting on an object the caller
// happens to have in scope — most of the ~40 email call sites select a narrow, pre-existing
// shape (`{ plan, customBrandingEnabled, logoUrl, ... }`) that predates accentColor/senderName/
// signatureHtml, so silently passing that object through would just as silently never surface
// the new fields (undefined ≠ "not set by the admin", but resolveDocumentBranding can't tell
// the difference). resolveEmailBranding() below sidesteps that entirely: instead of trusting
// whatever the caller already selected, it fetches exactly the columns it needs by id — every
// email call site already has the association's id in scope (it's how they fetched whatever
// narrower object they're using), so this is a drop-in replacement requiring no select-clause
// changes anywhere. Same short-TTL module-level cache pattern as getAssociationContactEmail()
// in src/lib/mail.ts, for the same reason: most of these call sites are one email in a batch
// (bulk sends, automation rules), so this avoids a repeat query per recipient.
const EMAIL_BRANDING_CACHE_TTL_MS = 30_000
type ResolvedBranding = ReturnType<typeof resolveDocumentBranding>
const emailBrandingCache = new Map<string, { value: ResolvedBranding; expiresAt: number }>()

export async function resolveEmailBranding(associationId: string): Promise<ResolvedBranding> {
  const cached = emailBrandingCache.get(associationId)
  if (cached && cached.expiresAt > Date.now()) return cached.value

  const empty: ResolvedBranding = { logoUrl: null, accentColor: null, senderName: null, signatureHtml: null, footer: null }
  let value = empty
  try {
    const association = await prisma.association.findUnique({
      where:  { id: associationId },
      select: { plan: true, customBrandingEnabled: true, logoUrl: true, primaryColor: true, emailSenderName: true, emailSignature: true, emailFooterSettings: true },
    })
    if (association) value = resolveDocumentBranding(association)
  } catch {
    value = empty // caller's own lookup already succeeded moments ago — a transient failure here just means an unbranded send, not a hard error
  }
  emailBrandingCache.set(associationId, { value, expiresAt: Date.now() + EMAIL_BRANDING_CACHE_TTL_MS })
  return value
}

// Called from every member-creation path (admin-created, initial registration, public
// self-registration, portal self-registration) right before the write. Throws
// MemberLimitReachedError instead of returning a boolean so a forgotten call site fails
// loudly in review rather than silently skipping the check. `count` covers a multi-registrant
// MembershipForm submission (see checkout/route.ts's "Ajouter un autre adhérent") adding more
// than one member at once — default 1 keeps every existing single-member call site's
// `activeCount >= limit` check exactly as it was (activeCount + 1 > limit is equivalent).
export async function assertMemberLimit(associationId: string, count = 1): Promise<void> {
  const association = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { plan: true, customMemberLimit: true },
  })
  if (!association) return // caller's own lookup will 404 right after this

  const [pricing, activeCount] = await Promise.all([
    getPricingInfo(),
    prisma.membre.count({ where: { associationId, status: "ACTIF", deletedAt: null } }),
  ])

  const limit = effectiveMemberLimit(association, pricing)
  if (activeCount + count > limit) throw new MemberLimitReachedError(limit)
}
