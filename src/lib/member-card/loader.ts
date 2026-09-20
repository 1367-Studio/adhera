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
  }
  association: {
    name:    string
    // Pro-gated exactly like the PDFs' logo (resolveDocumentBranding) — null for an
    // association without custom branding, which then gets the platform's default look.
    logoUrl: string | null
  }
}

// Server-side counterpart of getMemberCardEligibility: one query for everything the card
// needs, scoped by associationId so a membreId (or, later, a scanned token resolved to one)
// can never pull another tenant's member. Kept out of eligibility.ts so that module stays
// importable client-side and testable without a database. Returns null when the member
// doesn't exist in this association; callers turn that into a 404.
//
// Fields the association chose to hide (showPhoto/showCategory off) are dropped here rather
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
        select: { id: true, year: true, status: true, periodStart: true, periodEnd: true },
      },
      association: {
        select: { name: true, plan: true, customBrandingEnabled: true, logoUrl: true, memberCardSettings: true },
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

  return {
    eligibility,
    settings,
    membre: {
      firstName: membre.firstName,
      lastName:  membre.lastName,
      photoUrl:  settings.showPhoto ? membre.photoUrl : null,
      type:      settings.showCategory ? membre.type : null,
    },
    association: {
      name:    membre.association.name,
      logoUrl: resolveDocumentBranding(membre.association).logoUrl,
    },
  }
}
