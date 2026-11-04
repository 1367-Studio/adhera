// Pure constants shared by the merge engine (src/lib/membre-merge.ts, server-only), the zod
// schemas (src/lib/schemas/membre-duplicates.ts), and the compare/merge UI (client component)
// — kept free of prisma/server imports so the client bundle doesn't pull in server-only code.

// Scalar Membre columns an admin may choose to carry over from the secondary record onto the
// primary. Deliberately excludes ids, tokens (cardToken, adhesionCompletionToken…), and every
// timestamp — those are never a matter of "which side's value is right."
export const MERGEABLE_MEMBRE_FIELDS = [
  "firstName", "lastName", "email", "phone", "birthDate", "civilite",
  "address", "addressStreet", "addressComplement", "postalCode", "city", "country",
  "groupeSanguin", "sexe", "allergies", "photoUrl", "preferredLocale", "spokenLanguage",
  "possedeTshirt", "tailleTshirt", "typeId", "notes",
  "guardianName", "guardianPhone", "secondGuardianName", "secondGuardianPhone",
  "imageRightsConsent", "imageRightsConsentAt",
] as const

export type MergeableMembreField = (typeof MERGEABLE_MEMBRE_FIELDS)[number]
export type FieldResolution = "PRIMARY" | "SECONDARY"
export type FieldResolutions = Partial<Record<MergeableMembreField, FieldResolution>>
