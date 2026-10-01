import { collectPuckBlockIds } from "@/lib/site-puck/site-puck-tree"

// FORM-7: MembershipForm/DonationForm.siteSectionId can point at a legacy siteConfig section
// or at a Puck block (block ids were seeded from section ids, so both stores share them).
// A form binding is only dead when its id exists in NONE of the stores — deleting a section
// in one builder must not detach a form the other builder still shows.

type SiteStores = {
  siteConfig:        unknown
  siteDraft:         unknown
  sitePuckPublished: unknown
}

/** Ids of the sections of a legacy siteConfig JSON. */
export function siteConfigSectionIds(siteConfig: unknown): Set<string> {
  const sectionIds = new Set<string>()
  if (typeof siteConfig !== "object" || siteConfig === null) return sectionIds
  const sections = (siteConfig as { sections?: unknown }).sections
  if (!Array.isArray(sections)) return sectionIds
  for (const section of sections) {
    if (typeof section !== "object" || section === null) continue
    const sectionId = (section as { id?: unknown }).id
    if (typeof sectionId === "string" && sectionId !== "") sectionIds.add(sectionId)
  }
  return sectionIds
}

/** Every section / block id still present in at least one store. */
export function liveSiteSectionIds({ siteConfig, siteDraft, sitePuckPublished }: SiteStores): Set<string> {
  const liveIds = siteConfigSectionIds(siteConfig)
  for (const blockId of collectPuckBlockIds(siteDraft)) liveIds.add(blockId)
  for (const blockId of collectPuckBlockIds(sitePuckPublished)) liveIds.add(blockId)
  return liveIds
}
