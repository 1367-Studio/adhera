// Deliberately import-free: the template editor lists these targets in the browser, and the
// API routes (src/app/api/membres/paper-forms/…, src/app/api/membres/scan/extract) validate
// against the very same list — one owner, so a target added here shows up on both sides.

// Where one printed box of an association's paper form lands once a scan is imported.
// Order matters: it is the order the template editor offers them in.
export const PAPER_FORM_TARGETS = [
  // One box holding "Nom - Prénom" (or "Prénom Nom") — split into firstName/lastName at
  // extraction time, with the text kept as written alongside.
  "fullName",
  "firstName",
  "lastName",
  "email",
  "phone",
  "birthDate",
  // Free-text address as written — split into the structured columns through
  // src/lib/address.ts at creation time, never written raw into a column on its own.
  "address",
  "civilite",
  "sexe",
  // "Renseignements concernant les mineurs" — first and second parent/guardian. Stored as
  // text on the student's own record (Membre.guardianName/guardianPhone and the
  // secondGuardian* pair): a parent never becomes a member of their own.
  "guardianFullName",
  "guardianPhone",
  "secondGuardianFullName",
  "secondGuardianPhone",
  // Checkbox: consent to the association using the member's image.
  "imageRights",
  // Checkbox: acceptance of one AssociationDocument (règlement intérieur, …) — the field
  // then carries that document's id in legalDocumentId.
  "legalDocument",
  // Anything worth keeping with no column of its own (courses, forfait, remarks) — appended
  // to Membre.notes as "label : valeur".
  "notes",
  // Printed on the form but deliberately not imported (payment grid, signature, …).
  "ignore",
] as const

export type PaperFormTarget = (typeof PAPER_FORM_TARGETS)[number]

// Targets read as a ticked/unticked box (boolean) rather than as handwritten text.
export const PAPER_FORM_CHECKBOX_TARGETS = ["imageRights", "legalDocument"] as const satisfies readonly PaperFormTarget[]

// Targets holding a person's full name in one box — extraction also returns a first/last
// name split for these.
export const PAPER_FORM_FULL_NAME_TARGETS = ["fullName", "guardianFullName", "secondGuardianFullName"] as const satisfies readonly PaperFormTarget[]

export function isCheckboxTarget(target: PaperFormTarget): boolean {
  return (PAPER_FORM_CHECKBOX_TARGETS as readonly string[]).includes(target)
}

export function isFullNameTarget(target: PaperFormTarget): boolean {
  return (PAPER_FORM_FULL_NAME_TARGETS as readonly string[]).includes(target)
}

// Bounds shared by the zod schemas and the browser (page picker, PDF page count check).
export const PAPER_FORM_MAX_PAGES      = 4
export const PAPER_FORM_MAX_FIELDS     = 60
export const PAPER_FORM_FIELD_KEY_REGEX = /^[a-z0-9_]{1,40}$/

// The only page formats the analyze/extract routes accept — the browser renders PDF pages
// to JPEG before sending them.
export const PAPER_FORM_IMAGE_MEDIA_TYPES = ["image/jpeg", "image/png"] as const
export type PaperFormImageMediaType = (typeof PAPER_FORM_IMAGE_MEDIA_TYPES)[number]
