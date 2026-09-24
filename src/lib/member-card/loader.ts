import { prisma } from "@/lib/prisma/client"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { getMemberCardEligibility, type MemberCardEligibility } from "@/lib/member-card/eligibility"
import { parseMemberCardSettings, type MemberCardSettings } from "@/lib/member-card/settings"

export type MemberCardData = {
  eligibility: MemberCardEligibility
  settings:    MemberCardSettings
  membre: {
    firstName: string
    lastName:  string
    // Already null when settings.showPhoto / showCategory is off — see below.
    photoUrl:  string | null
    type:      { name: string; color: string } | null
    // Label of the MembershipTier behind the cotisation the card is actually printing (see
    // eligibility's cotisationId) — always shown when known, unlike category which is gated
    // by settings.showCategory: a tarifa is never the same thing as a MembreType.
    tier:      string | null
  }
  association: {
    name:    string
    // Pro-gated exactly like the PDFs' logo (resolveDocumentBranding) — null for an
    // association without custom branding, which then gets the platform's default look.
    logoUrl: string | null
    // Already null when settings.showPhone / showEmail is off, and when the association never
    // filled the field in — a blank string is normalized away here so no renderer has to
    // decide whether "  " is a phone number.
    phone:        string | null
    contactEmail: string | null
  }
}

/** "" and "   " mean "never filled in", which is the same absence as null for a card. */
function blankToNull(value: string | null): string | null {
  return value?.trim() || null
}

// Server-side counterpart of getMemberCardEligibility: one query for everything the card
// needs, scoped by associationId so a membreId (or, later, a scanned token resolved to one)
// can never pull another tenant's member. Kept out of eligibility.ts so that module stays
// importable client-side and testable without a database. Returns null when the member
// doesn't exist in this association; callers turn that into a 404.
//
// Fields the association chose to hide (showPhoto/showCategory/showPhone/showEmail off) are dropped here rather
// than left to the renderer, so a public scan endpoint can't leak them by forgetting a check.
// Display data is returned whatever the eligibility state — deciding what an unauthenticated
// scanner of a disabled or invalid card may see is the calling route's job.
export async function loadMemberCardEligibility(
  associationId: string,
  membreId: string,
  now: Date = new Date(),
): Promise<MemberCardData | null> {
  const membre = await prisma.membre.findFirst({
    where:  { id: membreId, associationId },
    select: {
      firstName: true,
      lastName:  true,
      photoUrl:  true,
      status:    true,
      deletedAt: true,
      type:      { select: { name: true, color: true } },
      // Every row, not just the current year's (unlike membreAdherentCotisationSelect): a
      // past PAYE/EXONERE row is what distinguishes "expired" from "no-membership". A member
      // has roughly one row per season, so this stays small.
      cotisations: {
        where:  { associationId },
        select: {
          id: true, year: true, status: true, periodStart: true, periodEnd: true,
          tier: { select: { label: true } },
        },
      },
      association: {
        select: {
          name: true, plan: true, customBrandingEnabled: true, logoUrl: true, memberCardSettings: true,
          // The association's own contact details, printed on the card only when the two
          // settings below say so.
          phone: true, contactEmail: true,
        },
      },
    },
  })
  if (!membre) return null

  const settings    = parseMemberCardSettings(membre.association.memberCardSettings)
  const eligibility = getMemberCardEligibility({
    cardEnabled: settings.enabled,
    membre:      { status: membre.status, deletedAt: membre.deletedAt },
    cotisations: membre.cotisations,
  }, now)

  // The tarifa printed is the tier behind the very cotisation whose dates/state the card
  // shows — "valid"/"unavailable"/"expired" all carry that row's id — never a different,
  // more-recent-but-unrelated row (see MembershipTier.membreTypeId for why tier ≠ category).
  const cardCotisationId = eligibility.state === "none" ? null : eligibility.cotisationId
  const tierLabel = cardCotisationId
    ? membre.cotisations.find(c => c.id === cardCotisationId)?.tier?.label ?? null
    : null

  return {
    eligibility,
    settings,
    membre: {
      firstName: membre.firstName,
      lastName:  membre.lastName,
      photoUrl:  settings.showPhoto ? membre.photoUrl : null,
      type:      settings.showCategory ? membre.type : null,
      tier:      tierLabel,
    },
    association: {
      name:    membre.association.name,
      logoUrl: resolveDocumentBranding(membre.association).logoUrl,
      phone:        settings.showPhone ? blankToNull(membre.association.phone)        : null,
      contactEmail: settings.showEmail ? blankToNull(membre.association.contactEmail) : null,
    },
  }
}
