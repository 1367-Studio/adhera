import type { DonsSection, SiteConfig, SiteSection } from "@/types/site-config"

// Client-safe (no Prisma): the site builder's view of which DonationForm each "dons" section
// shows, combining what's saved on the forms with the picks drafted in the section sheet.
// Server-side writes live in ./site-section-binding.ts.

// The fields of a DonationForm, as GET /api/donation-forms returns it, that decide where —
// if anywhere — it appears on the public site.
export type DonationFormPlacement = {
  id:            string
  slug:          string
  title:         string
  status:        "DRAFT" | "PUBLISHED" | "ARCHIVED"
  visibility:    "LINK" | "SITE" | "PRIVATE"
  siteSectionId: string | null
  createdAt:     string
  updatedAt:     string
}

function isDonsSection(section: SiteSection): section is DonsSection {
  return section.type === "dons"
}

function byMostRecentlyUpdated(first: DonationFormPlacement, second: DonationFormPlacement) {
  return second.updatedAt.localeCompare(first.updatedAt)
}

// An association "uses donation forms" once one has ever gone live (published, or archived
// after being published). Until then its "dons" blocks keep the legacy generic donation page;
// from then on a block with no form bound is hidden.
export function usesDonationForms(forms: DonationFormPlacement[]) {
  return forms.some(form => form.status === "PUBLISHED" || form.status === "ARCHIVED")
}

// Every published form currently on a section, most recently updated first — the first one is
// what the public site shows; any others are legacy duplicates. Also what a publish
// confirmation should name as "will be replaced".
export function findDonationFormsOnSiteSection(forms: DonationFormPlacement[], siteSectionId: string, excludeFormId?: string) {
  return forms
    .filter(form =>
      form.status === "PUBLISHED" && form.visibility === "SITE" && form.siteSectionId === siteSectionId && form.id !== excludeFormId)
    .sort(byMostRecentlyUpdated)
}

// Saved state only: sectionId → the form the public site shows there.
export function savedDonationFormBySection(forms: DonationFormPlacement[]) {
  const formBySection: Record<string, DonationFormPlacement> = {}
  const boundForms = forms
    .filter(form => form.status === "PUBLISHED" && form.visibility === "SITE" && form.siteSectionId)
    .sort(byMostRecentlyUpdated)
  for (const form of boundForms) {
    const sectionId = form.siteSectionId as string
    if (!formBySection[sectionId]) formBySection[sectionId] = form
  }
  return formBySection
}

// Draft-aware: sectionId → the form each "dons" section will show once the site is saved.
// A pick overrides the saved binding; a form can only be on one section, so the latest pick
// of a form wins and any section it was taken from (saved or picked) ends up empty — the
// same outcome the server produces when it applies the assignments.
export function resolveDonationFormBySection(sections: SiteSection[], forms: DonationFormPlacement[]) {
  const donsSections   = sections.filter(isDonsSection)
  const savedBySection = savedDonationFormBySection(forms)
  const publishedById  = new Map(forms.filter(form => form.status === "PUBLISHED").map(form => [form.id, form]))

  const winningPickByForm = new Map<string, { sectionId: string; pickedAt: number }>()
  for (const section of donsSections) {
    const pick = section.donationFormPick
    if (!pick?.formId) continue
    const currentWinner = winningPickByForm.get(pick.formId)
    if (!currentWinner || pick.pickedAt > currentWinner.pickedAt)
      winningPickByForm.set(pick.formId, { sectionId: section.id, pickedAt: pick.pickedAt })
  }

  const resolved: Record<string, DonationFormPlacement | null> = {}
  for (const section of donsSections) {
    const pick = section.donationFormPick
    if (pick) {
      const pickedForm = pick.formId ? publishedById.get(pick.formId) : undefined
      resolved[section.id] = pickedForm && winningPickByForm.get(pickedForm.id)?.sectionId === section.id ? pickedForm : null
    } else {
      const savedForm = savedBySection[section.id]
      resolved[section.id] = savedForm && !winningPickByForm.has(savedForm.id) ? savedForm : null
    }
  }
  return resolved
}

// The site-config save payload's donsFormAssignments: only the sections whose outcome differs
// from what's saved. A section with an explicit pick is also sent when legacy data left
// several published forms on it, so saving collapses them to the one picked.
export function changedDonationFormAssignments(sections: SiteSection[], forms: DonationFormPlacement[]) {
  const resolved       = resolveDonationFormBySection(sections, forms)
  const savedBySection = savedDonationFormBySection(forms)
  const assignments: Record<string, string | null> = {}

  for (const section of sections.filter(isDonsSection)) {
    const resolvedFormId = resolved[section.id]?.id ?? null
    const savedFormId    = savedBySection[section.id]?.id ?? null
    const hasDuplicates  = findDonationFormsOnSiteSection(forms, section.id).length > 1
    if (resolvedFormId !== savedFormId || (section.donationFormPick && hasDuplicates))
      assignments[section.id] = resolvedFormId
  }
  return assignments
}

export function stripDonationFormPicks(config: SiteConfig): SiteConfig {
  return {
    ...config,
    sections: config.sections.map(section => {
      if (!isDonsSection(section) || !section.donationFormPick) return section
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { donationFormPick, ...persistedSection } = section
      return persistedSection
    }),
  }
}
