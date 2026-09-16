import type { Prisma } from "@prisma/client"

// Accepts both the root client and an interactive-transaction client — every write helper
// below is meant to run inside the same transaction as the write that triggers it.
type DbClient = Prisma.TransactionClient

type SectionScope = {
  associationId: string
  siteSectionId: string
}

// A DonationForm is "on" a site section only when all three hold — the same filter the public
// site (getSiteData in [slug]/page.tsx) uses to decide what a "dons" block links to.
export function donationFormsOnSiteSectionWhere(scope: SectionScope, excludeFormId?: string): Prisma.DonationFormWhereInput {
  return {
    associationId: scope.associationId,
    siteSectionId: scope.siteSectionId,
    status:        "PUBLISHED",
    visibility:    "SITE",
    ...(excludeFormId ? { id: { not: excludeFormId } } : {}),
  }
}

// Read-only counterpart of displaceDonationFormsFromSiteSection: the forms that putting
// `formId` on this section would take off the site. Lets a confirmation step name them
// ("remplacera « X »") before anything is written.
export function findDonationFormsDisplacedBy(db: DbClient, scope: SectionScope & { formId: string }) {
  return db.donationForm.findMany({
    where:   donationFormsOnSiteSectionWhere(scope, scope.formId),
    orderBy: { updatedAt: "desc" },
    select:  { id: true, title: true },
  })
}

// One published form per "dons" section, enforced by replacing rather than blocking: every
// OTHER published form on the section goes back to LINK — still published and reachable by
// its own URL, just no longer on the site. Call it whenever a form becomes PUBLISHED while
// bound to a section, or becomes bound while PUBLISHED.
export function displaceDonationFormsFromSiteSection(tx: DbClient, scope: SectionScope & { keepFormId: string }) {
  return tx.donationForm.updateMany({
    where: donationFormsOnSiteSectionWhere(scope, scope.keepFormId),
    data:  { visibility: "LINK", siteSectionId: null },
  })
}

// Puts a PUBLISHED form on a section, taking whatever was there off the site. Moving a form
// away from another section leaves that section empty — nothing is promoted in its place.
export async function bindDonationFormToSiteSection(tx: DbClient, scope: SectionScope & { formId: string }) {
  await displaceDonationFormsFromSiteSection(tx, { ...scope, keepFormId: scope.formId })
  await tx.donationForm.updateMany({
    where: { id: scope.formId, associationId: scope.associationId },
    data:  { visibility: "SITE", siteSectionId: scope.siteSectionId },
  })
}

// Leaves a section with no published form, so the public site hides the block.
export function unbindDonationFormsFromSiteSection(tx: DbClient, scope: SectionScope) {
  return tx.donationForm.updateMany({
    where: donationFormsOnSiteSectionWhere(scope),
    data:  { visibility: "LINK", siteSectionId: null },
  })
}

// Deleted "dons" sections: any form still pointing at one (whatever its status) is released,
// otherwise a draft would silently reclaim a section id that no longer exists once published.
// Only SITE forms fall back to LINK — a PRIVATE form must never become reachable by link.
export async function releaseDeletedDonsSiteSections(tx: DbClient, scope: { associationId: string; siteSectionIds: string[] }) {
  if (scope.siteSectionIds.length === 0) return
  await tx.donationForm.updateMany({
    where: { associationId: scope.associationId, siteSectionId: { in: scope.siteSectionIds }, visibility: "SITE" },
    data:  { visibility: "LINK", siteSectionId: null },
  })
  await tx.donationForm.updateMany({
    where: { associationId: scope.associationId, siteSectionId: { in: scope.siteSectionIds } },
    data:  { siteSectionId: null },
  })
}
