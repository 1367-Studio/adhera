import type { PlatformLegalConfirmationType, PlatformLegalDocumentSlug } from "@prisma/client"

// FORM-113: Formwise's own legal documents, versioned here rather than in the database —
// only Formwise edits these five, across every association, unlike AssociationDocument
// (src/lib/legal/acceptance.ts), which each association authors and versions on its own.
// Bump a document's `version` (and update its page on formwise.fr) whenever the wording
// materially changes — any account with User.requiresLegalValidation set is then shown the
// pop-up again for that document, the same way CURRENT_TERMS_VERSION works in consent.ts.
export type PlatformLegalDocumentDef = {
  slug:             PlatformLegalDocumentSlug
  version:          number
  checkboxLabel:    string
  // Absent only for ASSOCIATION_AUTHORIZATION, which has no document of its own to consult.
  consultUrl?:      string
  confirmationType: PlatformLegalConfirmationType
}

export const PLATFORM_LEGAL_DOCUMENTS: readonly PlatformLegalDocumentDef[] = [
  {
    slug:             "CGU",
    version:          1,
    confirmationType: "ACCEPTATION",
    consultUrl:       "https://www.formwise.fr/fr/conditions-generales-utilisation/",
    checkboxLabel:    "J’accepte les Conditions générales d’utilisation de Formwise.",
  },
  {
    slug:             "CGV",
    version:          1,
    confirmationType: "ACCEPTATION",
    consultUrl:       "https://www.formwise.fr/fr/conditions-generales-vente/",
    checkboxLabel:    "J’accepte les Conditions générales de vente de Formwise.",
  },
  {
    slug:             "DPA",
    version:          1,
    confirmationType: "ACCEPTATION",
    consultUrl:       "https://www.formwise.fr/fr/accord-relatif-au-traitement-des-donnees-personnelles-dpa/",
    checkboxLabel:    "J’accepte l’Accord relatif au traitement des données personnelles de Formwise.",
  },
  {
    slug:             "PRIVACY_POLICY",
    version:          1,
    confirmationType: "PRISE_DE_CONNAISSANCE",
    consultUrl:       "https://www.formwise.fr/fr/politique-de-confidentialite/",
    checkboxLabel:    "Je confirme avoir pris connaissance de la Politique de confidentialité de Formwise.",
  },
  {
    slug:             "MENTIONS_LEGALES",
    version:          1,
    confirmationType: "PRISE_DE_CONNAISSANCE",
    consultUrl:       "https://www.formwise.fr/fr/mentions-legales/",
    checkboxLabel:    "Je confirme avoir pris connaissance des Mentions légales de Formwise.",
  },
  {
    slug:             "ASSOCIATION_AUTHORIZATION",
    version:          1,
    confirmationType: "ACCEPTATION",
    checkboxLabel:    "Je confirme être habilité(e) à engager {association} et à valider ces documents en son nom.",
  },
] as const

// The ASSOCIATION_AUTHORIZATION label carries a `{association}` placeholder — the association
// has no document to version, so it isn't in the catalog itself, just interpolated at render
// time by whoever displays the checkbox.
export function platformLegalCheckboxLabel(document: PlatformLegalDocumentDef, associationName: string): string {
  return document.checkboxLabel.replace("{association}", associationName)
}
