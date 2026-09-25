import { z } from "zod"
import {
  PAPER_FORM_TARGETS,
  PAPER_FORM_MAX_PAGES,
  PAPER_FORM_MAX_FIELDS,
  PAPER_FORM_FIELD_KEY_REGEX,
  PAPER_FORM_IMAGE_MEDIA_TYPES,
} from "@/lib/paper-form-targets"
import { ADDRESS_MAX_LENGTHS } from "@/lib/address"
import { MEMBRE_PHONE_REGEX } from "./membre"

// ─── Template ────────────────────────────────────────────────────────────────────────────

export const paperFormTargetSchema = z.enum(PAPER_FORM_TARGETS)

// One printed box/checkbox of the association's paper form. `page` is only range-checked
// against pagesPerForm by the template schema below, which sees both.
export const paperFormFieldSchema = z.object({
  key:             z.string().regex(PAPER_FORM_FIELD_KEY_REGEX, "Clé invalide (a-z, 0-9, _ ; 40 caractères max)"),
  label:           z.string().trim().min(1, "Libellé requis").max(200, "Libellé trop long (max 200 caractères)"),
  page:            z.number().int().min(1).max(PAPER_FORM_MAX_PAGES),
  target:          paperFormTargetSchema,
  legalDocumentId: z.string().min(1).optional(),
  // Reading help handed to the vision model ("écrit en majuscules", "case à droite", …).
  hint:            z.string().trim().max(300, "Indication trop longue (max 300 caractères)").optional(),
}).superRefine((field, ctx) => {
  if (field.target === "legalDocument" && !field.legalDocumentId) {
    ctx.addIssue({ code: "custom", path: ["legalDocumentId"], message: "Choisissez le document accepté par cette case" })
  }
  if (field.target !== "legalDocument" && field.legalDocumentId) {
    ctx.addIssue({ code: "custom", path: ["legalDocumentId"], message: "Un document ne peut être lié qu'à une case d'acceptation" })
  }
})

const templateNameField  = z.string().trim().min(1, "Nom requis").max(120, "Nom trop long (max 120 caractères)")
const pagesPerFormField  = z.number().int().min(1, "Au moins une page").max(PAPER_FORM_MAX_PAGES, `${PAPER_FORM_MAX_PAGES} pages maximum`)
// Printed title, year, association… that identify this exact form. Set → strict extraction
// (any other page is refused); empty/null → lenient, any page is read against the fields.
const identificationTextField = z.string().trim().max(300, "Texte d'identification trop long (max 300 caractères)")
  .nullable().optional()
  .transform((value) => value || null)
const templateFieldsField = z.array(paperFormFieldSchema)
  .min(1, "Au moins un champ")
  .max(PAPER_FORM_MAX_FIELDS, `${PAPER_FORM_MAX_FIELDS} champs maximum`)

export const paperFormTemplateSchema = z.object({
  name:         templateNameField,
  pagesPerForm:       pagesPerFormField,
  fields:             templateFieldsField,
  identificationText: identificationTextField,
}).superRefine((template, ctx) => {
  const seenKeys = new Set<string>()
  template.fields.forEach((field, fieldIndex) => {
    if (seenKeys.has(field.key)) {
      ctx.addIssue({ code: "custom", path: ["fields", fieldIndex, "key"], message: `Clé en double : ${field.key}` })
    }
    seenKeys.add(field.key)
    if (field.page > template.pagesPerForm) {
      ctx.addIssue({ code: "custom", path: ["fields", fieldIndex, "page"], message: `Page ${field.page} hors du modèle (${template.pagesPerForm} page(s))` })
    }
  })
})

// Every key optional; the PATCH route merges it over the stored template and re-validates
// the result with paperFormTemplateSchema, since the page range and the fields depend on
// each other and either side may be the one changing.
export const paperFormTemplateUpdateSchema = z.object({
  name:         templateNameField.optional(),
  pagesPerForm: pagesPerFormField.optional(),
  fields:       templateFieldsField.optional(),
  // Left as-is: absent = unchanged, null or "" = cleared (transformed to null).
  identificationText: z.string().trim().max(300, "Texte d'identification trop long (max 300 caractères)")
    .nullable().optional()
    .transform((value) => (value === undefined ? undefined : value || null)),
})

export type PaperFormField               = z.infer<typeof paperFormFieldSchema>
export type PaperFormTemplateInput       = z.input<typeof paperFormTemplateSchema>
export type PaperFormTemplateUpdateInput = z.input<typeof paperFormTemplateUpdateSchema>

// What GET/POST/PATCH /api/membres/paper-forms[/id] answer (dates serialized as ISO strings).
export type PaperFormTemplateResponse = {
  id:           string
  name:         string
  pagesPerForm: number
  fields:       PaperFormField[]
  // null = lenient extraction; set = strict (see identificationTextField).
  identificationText: string | null
  createdAt:    string
  updatedAt:    string
}

// ─── Page images (analyze / extract requests) ────────────────────────────────────────────

// Raw base64, no "data:…;base64," prefix. The declared mediaType is only a hint: the
// routes sniff the decoded bytes and refuse anything that is not really JPEG or PNG.
export const paperFormPageImageSchema = z.object({
  base64:    z.string().min(1, "Image requise"),
  mediaType: z.enum(PAPER_FORM_IMAGE_MEDIA_TYPES),
})

export const paperFormAnalyzeRequestSchema = z.object({
  pages: z.array(paperFormPageImageSchema).min(1, "Au moins une page").max(PAPER_FORM_MAX_PAGES, `${PAPER_FORM_MAX_PAGES} pages maximum`),
})

export const paperFormExtractRequestSchema = z.object({
  templateId: z.string().min(1, "Modèle requis"),
  page:       paperFormPageImageSchema,
})

export type PaperFormPageImage         = z.infer<typeof paperFormPageImageSchema>
export type PaperFormAnalyzeRequest    = z.infer<typeof paperFormAnalyzeRequestSchema>
export type PaperFormExtractRequest    = z.infer<typeof paperFormExtractRequestSchema>

// POST /api/membres/paper-forms/analyze — a proposal only, nothing is saved. Fields the
// model got wrong are dropped rather than failing the whole proposal; droppedFieldCount
// tells the editor how many so it can say so.
export type PaperFormAnalyzeResponse = {
  pagesPerForm:      number
  fields:            PaperFormField[]
  droppedFieldCount: number
}

// ─── Extraction response (POST /api/membres/scan/extract) ────────────────────────────────

export const paperFormConfidenceSchema = z.enum(["high", "low"])

const nullableText = z.string().nullable()

// One template field as read on the page. `value` type depends on the field's target:
//   - imageRights / legalDocument → boolean (ticked or not), null when unreadable
//   - birthDate  → "YYYY-MM-DD", null when absent or not a real date
//   - email      → lowercased, inner spaces removed
//   - civilite   → "M" | "MME" | "MLLE", sexe → "HOMME" | "FEMME", else null
//   - everything else → the text as written (trimmed)
// Extra keys, present only for the matching targets:
//   - fullName / guardianFullName / secondGuardianFullName → firstName + lastName split
//     (value keeps the whole box as written)
//   - address → addressParts, a best-effort split meant for src/lib/address.ts
//     (value keeps the whole address as written, for the legacy column/review screen)
export const paperFormExtractedValueSchema = z.object({
  value:        z.union([z.string(), z.boolean()]).nullable(),
  confidence:   paperFormConfidenceSchema,
  firstName:    nullableText.optional(),
  lastName:     nullableText.optional(),
  addressParts: z.object({
    street:     nullableText,
    complement: nullableText,
    postalCode: nullableText,
    city:       nullableText,
    country:    nullableText,
  }).optional(),
})

// pageNumber is the page as printed on the sheet ("Page 1/2" → 1), null when the sheet
// shows none — the review screen then falls back to upload order. When it is known, only
// fields of that page are returned; a field absent from `values` was not on this page.
export const paperFormExtractResponseSchema = z.object({
  pageNumber: z.number().int().min(1).nullable(),
  values:     z.record(z.string(), paperFormExtractedValueSchema),
})

export type PaperFormConfidence      = z.infer<typeof paperFormConfidenceSchema>
export type PaperFormExtractedValue  = z.infer<typeof paperFormExtractedValueSchema>
export type PaperFormExtractResponse = z.infer<typeof paperFormExtractResponseSchema>

// ─── Duplicate check (POST /api/membres/scan/duplicates) ─────────────────────────────────

// `ref` is the review screen's own id for a person (one per sheet: only the student is
// checked, guardians are never members): the answer is keyed by it, so the screen never has
// to match people back by name.
export const paperFormDuplicatePersonSchema = z.object({
  ref:       z.string().min(1).max(100),
  firstName: z.string().trim().max(200),
  lastName:  z.string().trim().max(200),
  email:     z.string().trim().max(254).nullable().optional(),
  phone:     z.string().trim().max(40).nullable().optional(),
})

export const paperFormDuplicatesRequestSchema = z.object({
  people: z.array(paperFormDuplicatePersonSchema).min(1, "Au moins une personne").max(200, "200 personnes maximum"),
})

export type PaperFormDuplicatePerson    = z.input<typeof paperFormDuplicatePersonSchema>
export type PaperFormDuplicatesRequest  = z.input<typeof paperFormDuplicatesRequestSchema>

export type PaperFormDuplicateMatch = {
  id:        string
  firstName: string
  lastName:  string
  email:     string | null
  phone:     string | null
  status:    string
}

// Refs without any match are left out; at most PAPER_FORM_DUPLICATE_MAX_MATCHES per ref.
export type PaperFormDuplicatesResponse = {
  matches: Record<string, PaperFormDuplicateMatch[]>
}

export const PAPER_FORM_DUPLICATE_MAX_MATCHES = 5

// ─── Commit (POST /api/membres/scan/commit) ──────────────────────────────────────────────

export const PAPER_FORM_COMMIT_MAX_FORMS = 100
export const PAPER_FORM_NOTES_MAX_LENGTH = 5000

// What the review screen sends for a box left empty: absent, null or "" all mean "nothing
// written" and land as null.
function optionalText(maxLength: number, tooLongMessage: string) {
  return z.string().trim().max(maxLength, tooLongMessage).nullable().optional()
    .transform((value) => value || null)
}

const optionalPhone = optionalText(40, "Numéro de téléphone trop long")
  .refine((value) => value === null || MEMBRE_PHONE_REGEX.test(value), "Numéro de téléphone invalide")

const optionalEmail = optionalText(254, "Email trop long")
  .transform((value) => value?.toLowerCase() ?? null)
  .refine((value) => value === null || z.email().safeParse(value).success, "Email invalide")

// Same "YYYY-MM-DD" the extraction answers, re-checked: the manager may have typed it over.
const optionalBirthDate = z.string().nullable().optional()
  .transform((value) => value || null)
  .refine((value) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value), "Date de naissance invalide (AAAA-MM-JJ)")
  .refine((value) => {
    if (value === null) return true
    const parsedDate = new Date(`${value}T12:00:00`)
    return !Number.isNaN(parsedDate.getTime()) && parsedDate.toISOString().startsWith(value) && parsedDate < new Date()
  }, "La date de naissance doit être une date réelle, dans le passé")

const requiredFirstName = z.string().trim().min(1, "Prénom requis").max(200, "Prénom trop long")
const requiredLastName  = z.string().trim().min(1, "Nom requis").max(200, "Nom trop long")

export const paperFormCommitStudentSchema = z.object({
  firstName:         requiredFirstName,
  lastName:          requiredLastName,
  email:             optionalEmail,
  phone:             optionalPhone,
  birthDate:         optionalBirthDate,
  civilite:          z.enum(["M", "MME", "MLLE"]).nullable().optional().transform((value) => value ?? null),
  sexe:              z.enum(["HOMME", "FEMME"]).nullable().optional().transform((value) => value ?? null),
  addressStreet:     optionalText(ADDRESS_MAX_LENGTHS.street, "Adresse trop longue"),
  addressComplement: optionalText(ADDRESS_MAX_LENGTHS.complement, "Complément d'adresse trop long"),
  postalCode:        optionalText(ADDRESS_MAX_LENGTHS.postalCode, "Code postal trop long"),
  city:              optionalText(ADDRESS_MAX_LENGTHS.city, "Ville trop longue"),
  country:           optionalText(ADDRESS_MAX_LENGTHS.country, "Pays trop long"),
})

// A parent filled in on the sheet. Never a member of their own: the name (as written) and
// the phone land on the student's record (Membre.guardianName/guardianPhone, or the
// secondGuardian* pair), nothing links to another Membre.
export const paperFormCommitGuardianSchema = z.object({
  name:  optionalText(200, "Nom du responsable trop long (max 200 caractères)"),
  phone: optionalPhone,
})

// Absent, null or a guardian with nothing written → null.
const optionalGuardian = paperFormCommitGuardianSchema.nullable().optional()
  .transform((guardian) => (guardian && (guardian.name || guardian.phone) ? guardian : null))

export const paperFormCommitFormSchema = z.object({
  ref:                      z.string().min(1).max(100),
  student:                  paperFormCommitStudentSchema,
  guardian:                 optionalGuardian,
  secondGuardian:           optionalGuardian,
  // Composed by the review screen (courses, "notes" boxes, answers without a column).
  notes:                    optionalText(PAPER_FORM_NOTES_MAX_LENGTH, `Notes trop longues (max ${PAPER_FORM_NOTES_MAX_LENGTH} caractères)`),
  // null/absent = the box was not on the sheet or unreadable: nothing is recorded.
  imageRights:              z.boolean().nullable().optional().transform((value) => value ?? null),
  acceptedLegalDocumentIds: z.array(z.string().min(1)).max(PAPER_FORM_MAX_FIELDS),
})

export const paperFormCommitRequestSchema = z.object({
  templateId: z.string().min(1, "Modèle requis"),
  forms:      z.array(paperFormCommitFormSchema)
    .min(1, "Au moins une fiche")
    .max(PAPER_FORM_COMMIT_MAX_FORMS, `${PAPER_FORM_COMMIT_MAX_FORMS} fiches maximum par import`),
}).superRefine((request, ctx) => {
  const seenRefs = new Set<string>()
  request.forms.forEach((form, formIndex) => {
    if (seenRefs.has(form.ref)) {
      ctx.addIssue({ code: "custom", path: ["forms", formIndex, "ref"], message: `Référence en double : ${form.ref}` })
    }
    seenRefs.add(form.ref)
  })
})

// z.input: what the review screen sends (empty strings allowed); the route works on the
// parsed output, where every empty box is null.
export type PaperFormCommitStudent  = z.input<typeof paperFormCommitStudentSchema>
export type PaperFormCommitGuardian = z.input<typeof paperFormCommitGuardianSchema>
export type PaperFormCommitForm     = z.input<typeof paperFormCommitFormSchema>
export type PaperFormCommitRequest  = z.input<typeof paperFormCommitRequestSchema>
export type ParsedPaperFormCommitForm = z.output<typeof paperFormCommitFormSchema>

export type PaperFormCommitResult =
  | {
      ref:      string
      status:   "created"
      membreId: string
      // Ticked documents that no longer require acceptance (no revision in force): nothing
      // could be recorded for them.
      skippedLegalDocumentIds: string[]
    }
  | { ref: string; status: "error"; error: string }

export type PaperFormCommitResponse = {
  results: PaperFormCommitResult[]
}
