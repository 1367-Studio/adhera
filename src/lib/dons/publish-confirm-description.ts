import type { DonsSection, SiteSection } from "@/types/site-config"
import { findDonationFormsOnSiteSection, usesDonationForms, type DonationFormPlacement } from "./site-section-picks"

// Scoped to the "donationForms" namespace.
type Translate = (key: string, values?: Record<string, string>) => string

// The publish confirmation's text: where the form will appear, and which site block the publish
// hides. Reads the form's SAVED placement — both callers only confirm a publish when nothing is
// left unsaved. Shared by the forms list and the form's own page so the two never disagree.
export function publishConfirmDescription({
  form,
  forms,
  sections,
  donsModuleEnabled,
  fallbackSectionTitle,
  translate,
}: {
  form:                 Pick<DonationFormPlacement, "id" | "visibility" | "siteSectionId">
  // undefined while the list is loading: nothing is named as replaced, no block announced as hidden.
  forms:                DonationFormPlacement[] | undefined
  sections:             SiteSection[]
  donsModuleEnabled:    boolean
  fallbackSectionTitle: string
  translate:            Translate
}) {
  const donsSections  = sections.filter((section): section is DonsSection => section.type === "dons")
  const sectionTitle  = (section: DonsSection) => section.title || fallbackSectionTitle
  // A SITE form whose section was deleted from the site is only reachable by its link.
  const targetSection = form.visibility === "SITE"
    ? donsSections.find(section => section.id === form.siteSectionId)
    : undefined

  let description: string
  if (targetSection) {
    const currentForm = findDonationFormsOnSiteSection(forms ?? [], targetSection.id, form.id)[0]
    description = currentForm
      ? translate("formsView.publishConfirm.descriptionSiteReplace", { title: currentForm.title, section: sectionTitle(targetSection) })
      : translate("formsView.publishConfirm.descriptionSite", { section: sectionTitle(targetSection) })
  } else if (form.visibility === "PRIVATE") {
    description = translate("formsView.publishConfirm.descriptionPrivate")
  } else {
    description = translate("formsView.publishConfirm.descriptionLink")
  }

  // The first publish takes a legacy association off the generic donation page, and from then
  // on every "dons" block with no form bound is hidden on the public site.
  const hiddenSection = forms && !usesDonationForms(forms) && donsModuleEnabled
    ? donsSections.find(section => section.id !== targetSection?.id)
    : undefined

  return hiddenSection
    ? `${description} ${translate("formsView.publishConfirm.blockHiddenNote", { section: sectionTitle(hiddenSection) })}`
    : description
}
