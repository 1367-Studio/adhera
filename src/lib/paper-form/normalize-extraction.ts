import { isCheckboxTarget, isFullNameTarget, PAPER_FORM_FIELD_KEY_REGEX, PAPER_FORM_MAX_FIELDS } from "@/lib/paper-form-targets"
import {
  paperFormFieldSchema,
  type PaperFormConfidence,
  type PaperFormExtractResponse,
  type PaperFormExtractedValue,
  type PaperFormField,
} from "@/lib/schemas"

// Pure post-processing of what the vision model answered — every value is re-typed and
// re-checked here, the model's output is never passed through as-is.

const MAX_TEXT_LENGTH = 1000

function isPlainObject(candidate: unknown): candidate is Record<string, unknown> {
  return !!candidate && typeof candidate === "object" && !Array.isArray(candidate)
}

function cleanText(candidate: unknown): string | null {
  if (typeof candidate === "number") return String(candidate)
  if (typeof candidate !== "string") return null
  const trimmedText = candidate.trim().slice(0, MAX_TEXT_LENGTH)
  return trimmedText ? trimmedText : null
}

// ─── Analyze (blank form → proposed template fields) ────────────────────────────────────

function slugifyKey(label: string): string {
  return label
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "champ"
}

// Keeps the key within 40 characters once a "_2", "_3"… suffix is appended.
function uniqueKey(baseKey: string, usedKeys: Set<string>): string {
  let candidateKey = baseKey
  for (let suffixNumber = 2; usedKeys.has(candidateKey); suffixNumber++) {
    const suffix = `_${suffixNumber}`
    candidateKey = `${baseKey.slice(0, 40 - suffix.length)}${suffix}`
  }
  usedKeys.add(candidateKey)
  return candidateKey
}

// Turns the model's proposal into fields that pass paperFormFieldSchema, dropping the ones
// that cannot be repaired. A commitment checkbox pointing at a document the association
// does not have is kept, but downgraded to "ignore" — the manager picks the document.
export function normalizeProposedFields(
  rawProposal: unknown,
  pagesPerForm: number,
  legalDocumentIds: Set<string>,
): { fields: PaperFormField[]; droppedFieldCount: number } {
  const rawFields = isPlainObject(rawProposal) && Array.isArray(rawProposal.fields)
    ? rawProposal.fields
    : Array.isArray(rawProposal) ? rawProposal : []

  const usedKeys = new Set<string>()
  const fields: PaperFormField[] = []
  let droppedFieldCount = 0

  for (const rawField of rawFields) {
    if (!isPlainObject(rawField) || fields.length >= PAPER_FORM_MAX_FIELDS) {
      droppedFieldCount++
      continue
    }

    const label = cleanText(rawField.label)?.slice(0, 200) ?? null
    const rawKey = typeof rawField.key === "string" ? rawField.key.trim().toLowerCase() : ""
    const baseKey = PAPER_FORM_FIELD_KEY_REGEX.test(rawKey) ? rawKey : slugifyKey(label ?? "")
    const page = typeof rawField.page === "number" ? Math.trunc(rawField.page) : Number.parseInt(String(rawField.page ?? ""), 10)

    let target = rawField.target
    let legalDocumentId: string | undefined =
      typeof rawField.legalDocumentId === "string" ? rawField.legalDocumentId : undefined
    if (target === "legalDocument" && (!legalDocumentId || !legalDocumentIds.has(legalDocumentId))) {
      target          = "ignore"
      legalDocumentId = undefined
    }
    if (target !== "legalDocument") legalDocumentId = undefined

    const hint = cleanText(rawField.hint)?.slice(0, 300)

    const candidateField = {
      key:   baseKey,
      label: label ?? "",
      page,
      target,
      ...(legalDocumentId ? { legalDocumentId } : {}),
      ...(hint ? { hint } : {}),
    }

    const parsed = paperFormFieldSchema.safeParse(candidateField)
    if (!parsed.success || parsed.data.page > pagesPerForm) {
      droppedFieldCount++
      continue
    }

    fields.push({ ...parsed.data, key: uniqueKey(parsed.data.key, usedKeys) })
  }

  return { fields, droppedFieldCount }
}

// ─── Extract (filled page → values keyed by template field) ─────────────────────────────

function readConfidence(candidate: unknown): PaperFormConfidence {
  return candidate === "high" ? "high" : "low"
}

function normalizeCheckbox(candidate: unknown): boolean | null {
  if (typeof candidate === "boolean") return candidate
  const text = cleanText(candidate)?.toLowerCase()
  if (!text) return null
  if (["true", "oui", "yes", "x", "coché", "coche", "1"].includes(text)) return true
  if (["false", "non", "no", "0", "vide", "non coché"].includes(text)) return false
  return null
}

function isRealPastDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
    && year >= 1900
    && date.getTime() <= Date.now()
}

// "YYYY-MM-DD" as asked, or the French DD/MM/YYYY (also with - or .) a model may copy
// verbatim from the sheet. Anything else — two-digit years included — is left unread
// rather than guessed.
function normalizeBirthDate(candidate: unknown): string | null {
  const text = cleanText(candidate)
  if (!text) return null

  const isoMatch    = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  const frenchMatch = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text)
  const [year, month, day] = isoMatch
    ? [Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3])]
    : frenchMatch
      ? [Number(frenchMatch[3]), Number(frenchMatch[2]), Number(frenchMatch[1])]
      : [0, 0, 0]

  if (!isRealPastDate(year, month, day)) return null
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

function normalizeEnumValue(candidate: unknown, aliases: Record<string, string>): string | null {
  const text = cleanText(candidate)
  if (!text) return null
  const aliasKey = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[.\s]/g, "")
  return aliases[aliasKey] ?? null
}

const CIVILITE_ALIASES: Record<string, string> = {
  M: "M", MR: "M", MONSIEUR: "M",
  MME: "MME", MADAME: "MME",
  MLLE: "MLLE", MELLE: "MLLE", MADEMOISELLE: "MLLE",
}

const SEXE_ALIASES: Record<string, string> = {
  H: "HOMME", HOMME: "HOMME", M: "HOMME", MASCULIN: "HOMME", GARCON: "HOMME",
  F: "FEMME", FEMME: "FEMME", FEMININ: "FEMME", FILLE: "FEMME",
}

const SIMPLE_EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

function normalizeValue(field: PaperFormField, rawEntry: unknown): PaperFormExtractedValue {
  // A model may answer a bare value instead of { value, confidence } — accepted, but
  // never with high confidence.
  const entry            = isPlainObject(rawEntry) ? rawEntry : { value: rawEntry }
  const statedConfidence = readConfidence(entry.confidence)
  const rawValue         = entry.value

  if (isCheckboxTarget(field.target)) {
    const checked = normalizeCheckbox(rawValue)
    return { value: checked, confidence: checked === null ? "low" : statedConfidence }
  }

  switch (field.target) {
    case "birthDate": {
      const isoDate = normalizeBirthDate(rawValue)
      return { value: isoDate, confidence: isoDate === null && cleanText(rawValue) ? "low" : statedConfidence }
    }
    case "email": {
      const email = cleanText(rawValue)?.replace(/\s+/g, "").toLowerCase() ?? null
      return { value: email, confidence: email && !SIMPLE_EMAIL_REGEX.test(email) ? "low" : statedConfidence }
    }
    case "civilite":
    case "sexe": {
      const enumValue = normalizeEnumValue(rawValue, field.target === "civilite" ? CIVILITE_ALIASES : SEXE_ALIASES)
      return { value: enumValue, confidence: enumValue === null && cleanText(rawValue) ? "low" : statedConfidence }
    }
    case "address": {
      const rawParts = isPlainObject(entry.addressParts) ? entry.addressParts : {}
      return {
        value:        cleanText(rawValue),
        confidence:   statedConfidence,
        addressParts: {
          street:     cleanText(rawParts.street),
          complement: cleanText(rawParts.complement),
          postalCode: cleanText(rawParts.postalCode),
          city:       cleanText(rawParts.city),
          country:    cleanText(rawParts.country),
        },
      }
    }
  }

  const text = cleanText(rawValue)
  if (isFullNameTarget(field.target)) {
    return {
      value:      text,
      confidence: statedConfidence,
      firstName:  cleanText(entry.firstName),
      lastName:   cleanText(entry.lastName),
    }
  }
  return { value: text, confidence: statedConfidence }
}

// Only keys of the template come out, and only the ones the model actually answered. When
// the sheet shows its page number, fields printed on another page are dropped too, so a
// null answered for a page-2 box can never erase what page 2 itself said.
export function normalizeExtraction(
  rawAnswer: unknown,
  fields: PaperFormField[],
  pagesPerForm: number,
): PaperFormExtractResponse {
  const answer = isPlainObject(rawAnswer) ? rawAnswer : {}

  const statedPage = typeof answer.pageNumber === "number" ? Math.trunc(answer.pageNumber) : null
  const pageNumber = statedPage !== null && statedPage >= 1 && statedPage <= pagesPerForm ? statedPage : null

  const rawValues = isPlainObject(answer.values) ? answer.values : {}
  const values: Record<string, PaperFormExtractedValue> = {}

  for (const field of fields) {
    if (field.target === "ignore") continue
    if (pageNumber !== null && field.page !== pageNumber) continue
    if (!Object.prototype.hasOwnProperty.call(rawValues, field.key)) continue
    values[field.key] = normalizeValue(field, rawValues[field.key])
  }

  return { pageNumber, values }
}
