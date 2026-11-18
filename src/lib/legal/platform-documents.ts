import type { PlatformLegalConfirmationType, PlatformLegalDocumentSlug } from "@prisma/client"
import { latestSanityUpdateVersion } from "@/lib/legal/sanity-version"

// FORM-113: Formwise's own legal documents, versioned here rather than in the database —
// only Formwise edits these five, across every association, unlike AssociationDocument
// (src/lib/legal/acceptance.ts), which each association authors and versions on its own.
// Bump a document's `version` (and update its page on formwise.fr) whenever the wording
// materially changes enough that an already-flagged account should be shown the pop-up again
// for that document — a deliberate, reviewed decision, unlike getCurrentLegalDocumentsVersion
// below or getCurrentTermsVersion in consent.ts, which both read Sanity's own _updatedAt live.
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

// FORM-91: the page listing all five documents above (everything except
// ASSOCIATION_AUTHORIZATION, which isn't a Formwise document) in one place — linked from the
// mandatory checkbox at /register and permanently from the account menu, instead of linking
// each document individually.
export const LEGAL_DOCUMENTS_PAGE_URL = "https://www.formwise.fr/fr/documents-legaux/"

// The Sanity document ids (not slugs — slugs can change) backing LEGAL_DOCUMENTS_PAGE_URL:
// the aggregator page itself, plus every document it links to. Edited directly in the Sanity
// Studio, same as the catalog above, but there's no per-document granularity to track here —
// FORM-91 only ever records one version for "the page as a whole, as presented at signup".
const LEGAL_DOCUMENTS_PAGE_SANITY_IDS = [
  "a4d1d8b9-7f24-4924-a8c9-773ea81d4f13", // documents-legaux (the aggregator page itself)
  "tr-10b6c0a4-3726-4b2d-993b-83a61f5bfb7d", // CGU
  "legal-fr-1be64bd481c243a69be4", // CGV
  "18d6ccd7-efbb-4951-bc25-4a67ee579ce6", // DPA
  "tr-3a0d4261-21c6-40ca-94d1-6539718a2c47", // Politique de confidentialité
  "tr-d23e2ef7-92b2-45cc-8760-d97a8e49128e", // Mentions légales
] as const

// Stored on User.termsVersion at signup — the most recent publish date across the aggregator
// page and everything it links to, read live from Sanity (cached 1h) rather than a string a
// developer has to remember to bump. Independent of each document's own `version` above, which
// exists for FORM-113's per-document re-confirmation gate.
export function getCurrentLegalDocumentsVersion(): Promise<string> {
  return latestSanityUpdateVersion(LEGAL_DOCUMENTS_PAGE_SANITY_IDS, "2026-11-18")
}
