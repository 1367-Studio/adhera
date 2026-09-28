// Pure logic of the paper-form import: pages → forms grouping, value merging, the editable
// review draft, validation and the commit payload. No React here, so every rule the review
// screen relies on can be read (and reasoned about) in one place.

import {
  paperFormCommitFormSchema,
  type PaperFormCommitForm,
  type PaperFormCommitStudent,
  type PaperFormDuplicateMatch,
  type PaperFormExtractResponse,
  type PaperFormExtractedValue,
  type PaperFormField,
  type PaperFormTemplateResponse,
} from "@/lib/schemas/paper-form"
import { EMPTY_ADDRESS_FORM_VALUES, type AddressFormValues } from "@/lib/address"

// ─── Pages ───────────────────────────────────────────────────────────────────────────────

// "refused" = a strict template recognised this page as another document. Final: such a page
// is never grouped into a form, so nothing can be created from it.
export type ScanPageStatus = "pending" | "reading" | "done" | "error" | "refused"

// Where the manager said a phone photo belongs: « fiche 3, page 2 » (both 1-based). Given at
// capture time, so it outranks whatever page number the model could (or could not) read.
export type CapturedSlot = {
  formNumber: number
  pageNumber: number
}

export type ScanPage = {
  pageId:      string
  // Position in upload order — the fallback order when the sheet shows no page number.
  uploadIndex: number
  sourceFileId: string
  sourceName:  string
  // The page bytes themselves are not kept here but in usePageReader's payload map, which
  // drops them once the page is read — 300 pages of base64 have no business in React state.
  previewUrl:  string
  width:       number
  height:      number
  status:      ScanPageStatus
  error:       string | null
  result:      PaperFormExtractResponse | null
  // Title read on a refused page ("Autorisation de sortie"…), null when none was readable.
  detectedTitle: string | null
  // Slot the manager tagged a phone photo with; null for a page of an uploaded file, which
  // is placed by its printed page number and upload order instead.
  capturedSlot: CapturedSlot | null
}

export function isRefusedPage(page: ScanPage): boolean {
  return page.status === "refused"
}

// ─── Forms (one person each) ─────────────────────────────────────────────────────────────

export type ScanFormStatus = "toReview" | "validated" | "ignored" | "error" | "created"

export type ImageRightsChoice = "yes" | "no" | "unknown"

export type ReviewDraft = {
  firstName:                string
  lastName:                 string
  email:                    string
  phone:                    string
  birthDate:                string
  civilite:                 "" | "M" | "MME" | "MLLE"
  sexe:                     "" | "HOMME" | "FEMME"
  address:                  AddressFormValues
  // Legal guardians are stored on the student's own record (name as written + phone),
  // never created as separate members.
  guardianName:             string
  guardianPhone:            string
  secondGuardianName:       string
  secondGuardianPhone:      string
  imageRights:              ImageRightsChoice
  acceptedLegalDocumentIds: string[]
  notes:                    string
}

// Draft keys read with low confidence, plus `legal:<documentId>` for acceptance boxes.
export type LowConfidenceKey = keyof ReviewDraft | keyof AddressFormValues | `legal:${string}`

export type DuplicateMatch = PaperFormDuplicateMatch

// One acceptance box of the sheet linked to a legal document, as it will read in the member's
// notes (« Règlement Intérieur : Oui » / « … : Non »). Offline acceptances only surface in the
// per-document CSV export, not on the member file, so the notes keep the sheet's answer where
// the manager looks. Both wordings are resolved when the form is built (same labels as every
// other notes line); which one applies is decided at commit time from the final checkboxes,
// so a box the manager ticks or unticks in review can never leave a contradicting line.
export type LegalDocumentNoteLine = {
  legalDocumentId: string
  acceptedLine:    string
  declinedLine:    string
}

// A duplicate check result is only meaningful for the name it was run on: once the manager
// edits the name, the stored matches are stale and hidden until the next check.
export type DuplicateCheck = {
  checkedName: string
  matches:     DuplicateMatch[]
}

export type ScanForm = {
  formId:           string
  // Page ids by position in the form (index 0 = page 1); null = page missing.
  pageSlots:        (string | null)[]
  draft:            ReviewDraft
  lowConfidence:    LowConfidenceKey[]
  status:           ScanFormStatus
  errorMessage:     string | null
  membreId:         string | null
  skippedLegalDocumentIds: string[]
  studentDuplicates: DuplicateCheck | null
  // Linked acceptance boxes whose page was read, in template order (see toCommitForm).
  legalDocumentNoteLines: LegalDocumentNoteLine[]
}

export function hasMissingPage(form: ScanForm): boolean {
  return form.pageSlots.some((pageId) => pageId === null)
}

// 1-based numbers of the pages the form lacks, for « Page 2 absente ».
export function missingPageNumbers(form: ScanForm): number[] {
  return form.pageSlots.flatMap((pageId, slotIndex) => (pageId === null ? [slotIndex + 1] : []))
}

// Something to double-check rather than an error (low-confidence reading, missing page): the
// same amber the shared Badge `warning` variant uses, shared by the review list and editor.
export const LOW_CONFIDENCE_TEXT_CLASS = "text-xs text-amber-700 dark:text-amber-400"

// ─── Grouping ────────────────────────────────────────────────────────────────────────────

// Pages arrive in upload order. A printed page number decides where a page goes: "1" always
// starts a new person, a number whose slot is already taken too (the previous form is over).
// Without a number the page simply takes the next slot, and a full form starts a new one.
// Refused pages are skipped altogether: they neither start a person nor fill a missing page,
// so a form whose other page was refused keeps an empty slot (shown as a missing page).
//
// Captured pages (phone photos tagged « fiche N, page P ») bypass all of that: the manager's
// tag is authoritative, the printed number is ignored. Each captured fiche number gets its own
// form, created where its first photo appears in upload order, with the photo in slot P. When
// two photos claim the same slot of the same fiche, the later one starts a NEW form in that
// slot rather than replacing the earlier one — no page is ever silently dropped, and the
// manager sees two forms to reconcile. Further photos of that fiche go to the newest form.
// Uploaded pages never land in a captured form: their "current form" is only ever one they
// started themselves, so with no captured page the output is exactly the upload-only one.
export function groupPagesIntoForms(pages: ScanPage[], pagesPerForm: number): (string | null)[][] {
  const groupedSlots: (string | null)[][] = []
  // Current form of each flow: the last one the uploaded pages started, and per captured
  // fiche number the form its photos currently fill.
  let uploadedFormSlots: (string | null)[] | null = null
  const capturedFormSlotsByNumber = new Map<number, (string | null)[]>()

  const startForm = (): (string | null)[] => {
    const emptySlots: (string | null)[] = Array.from({ length: pagesPerForm }, () => null)
    groupedSlots.push(emptySlots)
    return emptySlots
  }

  const startUploadedForm = (): (string | null)[] => {
    uploadedFormSlots = startForm()
    return uploadedFormSlots
  }

  const groupablePages = pages.filter((page) => !isRefusedPage(page))
  for (const page of groupablePages.sort((first, second) => first.uploadIndex - second.uploadIndex)) {
    // A tag outside the template's pages (template switched after capture) is not trusted:
    // the page is then placed like an uploaded one.
    const capturedSlot = page.capturedSlot
    if (capturedSlot && capturedSlot.pageNumber >= 1 && capturedSlot.pageNumber <= pagesPerForm) {
      const capturedSlotIndex = capturedSlot.pageNumber - 1
      let capturedSlots = capturedFormSlotsByNumber.get(capturedSlot.formNumber)
      if (!capturedSlots || capturedSlots[capturedSlotIndex] !== null) {
        capturedSlots = startForm()
        capturedFormSlotsByNumber.set(capturedSlot.formNumber, capturedSlots)
      }
      capturedSlots[capturedSlotIndex] = page.pageId
      continue
    }

    const printedNumber = page.result?.pageNumber ?? null
    const knownNumber   = printedNumber !== null && printedNumber >= 1 && printedNumber <= pagesPerForm ? printedNumber : null

    let slots: (string | null)[] = uploadedFormSlots ?? startUploadedForm()
    let slotIndex: number

    if (knownNumber !== null) {
      slotIndex = knownNumber - 1
      if (knownNumber === 1 && slots.some((pageId) => pageId !== null)) slots = startUploadedForm()
      else if (slots[slotIndex] !== null) slots = startUploadedForm()
    } else {
      const lastFilledIndex = slots.reduce((lastIndex, pageId, index) => (pageId !== null ? index : lastIndex), -1)
      slotIndex = lastFilledIndex + 1
      if (slotIndex >= pagesPerForm) {
        slots = startUploadedForm()
        slotIndex = 0
      }
    }

    slots[slotIndex] = page.pageId
  }

  return groupedSlots
}

// ─── Merging ─────────────────────────────────────────────────────────────────────────────

function isFilled(extracted: PaperFormExtractedValue | undefined): extracted is PaperFormExtractedValue {
  if (!extracted || extracted.value === null) return false
  return typeof extracted.value === "boolean" || extracted.value.trim() !== ""
}

// First non-empty value wins, in page order. A key present only as null is kept as null, so
// "the box was there but empty" still reads as such.
export function mergePageValues(pagesInOrder: ScanPage[]): Record<string, PaperFormExtractedValue> {
  const merged: Record<string, PaperFormExtractedValue> = {}
  for (const page of pagesInOrder) {
    if (isRefusedPage(page)) continue
    for (const [fieldKey, extracted] of Object.entries(page.result?.values ?? {})) {
      if (isFilled(merged[fieldKey])) continue
      if (isFilled(extracted) || !(fieldKey in merged)) merged[fieldKey] = extracted
    }
  }
  return merged
}

// ─── Draft ───────────────────────────────────────────────────────────────────────────────

export const EMPTY_DRAFT: ReviewDraft = {
  firstName: "", lastName: "", email: "", phone: "", birthDate: "", civilite: "", sexe: "",
  address: { ...EMPTY_ADDRESS_FORM_VALUES },
  guardianName: "", guardianPhone: "", secondGuardianName: "", secondGuardianPhone: "",
  imageRights: "unknown", acceptedLegalDocumentIds: [], notes: "",
}

type PersonName = { firstName: string; lastName: string; lowConfidence: boolean }

function textOf(extracted: PaperFormExtractedValue | undefined): string {
  if (!extracted || typeof extracted.value !== "string") return ""
  return extracted.value.trim()
}

function splitName(extracted: PaperFormExtractedValue | undefined): PersonName | null {
  if (!isFilled(extracted)) return null
  const firstName = extracted.firstName?.trim() ?? ""
  const lastName  = extracted.lastName?.trim() ?? ""
  // No split from the model: the whole box goes to the last name, where the manager sees it.
  if (!firstName && !lastName) return { firstName: "", lastName: textOf(extracted), lowConfidence: true }
  return { firstName, lastName, lowConfidence: extracted.confidence === "low" }
}

export type BooleanLabels = { yes: string; no: string }

function describeForNotes(extracted: PaperFormExtractedValue, booleanLabels: BooleanLabels): string {
  if (typeof extracted.value === "boolean") return extracted.value ? booleanLabels.yes : booleanLabels.no
  return (extracted.value ?? "").trim()
}

export type DraftBuildLabels = {
  booleans: BooleanLabels
}

export function buildDraft(
  fields: PaperFormField[],
  mergedValues: Record<string, PaperFormExtractedValue>,
  labels: DraftBuildLabels,
): { draft: ReviewDraft; lowConfidence: LowConfidenceKey[]; legalDocumentNoteLines: LegalDocumentNoteLine[] } {
  const draft: ReviewDraft = { ...EMPTY_DRAFT, address: { ...EMPTY_ADDRESS_FORM_VALUES }, acceptedLegalDocumentIds: [] }
  const lowConfidence = new Set<LowConfidenceKey>()
  const noteLines: string[] = []
  const legalDocumentNoteLines: LegalDocumentNoteLine[] = []

  // Held in one object: TypeScript does not follow assignments made inside the switch below
  // and would narrow a standalone `let … = null` variable to `never` after the loop.
  const names: { student: PersonName | null } = { student: null }

  // Several boxes may share a target (two phone lines…): the first filled one wins. Guardian
  // names are kept whole, as written on the sheet.
  const setText = (
    draftKey: "email" | "phone" | "birthDate" | "guardianName" | "guardianPhone" | "secondGuardianName" | "secondGuardianPhone",
    extracted: PaperFormExtractedValue,
  ) => {
    if (draft[draftKey] || !isFilled(extracted)) return
    draft[draftKey] = textOf(extracted)
    if (extracted.confidence === "low") lowConfidence.add(draftKey)
  }

  for (const field of fields) {
    const extracted = mergedValues[field.key]
    if (!extracted) continue
    const isLow = extracted.confidence === "low"

    switch (field.target) {
      case "fullName":
        names.student ??= splitName(extracted)
        break
      case "firstName":
        if (isFilled(extracted) && !names.student?.firstName) {
          names.student = { firstName: textOf(extracted), lastName: names.student?.lastName ?? "", lowConfidence: isLow || !!names.student?.lowConfidence }
        }
        break
      case "lastName":
        if (isFilled(extracted) && !names.student?.lastName) {
          names.student = { firstName: names.student?.firstName ?? "", lastName: textOf(extracted), lowConfidence: isLow || !!names.student?.lowConfidence }
        }
        break
      case "email":
      case "phone":
      case "birthDate":
        setText(field.target, extracted)
        break
      case "civilite":
        if (!draft.civilite && (extracted.value === "M" || extracted.value === "MME" || extracted.value === "MLLE")) {
          draft.civilite = extracted.value
          if (isLow) lowConfidence.add("civilite")
        }
        break
      case "sexe":
        if (!draft.sexe && (extracted.value === "HOMME" || extracted.value === "FEMME")) {
          draft.sexe = extracted.value
          if (isLow) lowConfidence.add("sexe")
        }
        break
      case "address":
        if (isFilled(extracted) && !draft.address.addressStreet && !draft.address.city) {
          const parts = extracted.addressParts
          draft.address = parts
            ? {
                addressStreet:     parts.street?.trim() ?? "",
                addressComplement: parts.complement?.trim() ?? "",
                postalCode:        parts.postalCode?.trim() ?? "",
                city:              parts.city?.trim() ?? "",
                country:           parts.country?.trim() ?? "",
              }
            : { ...EMPTY_ADDRESS_FORM_VALUES, addressStreet: textOf(extracted) }
          if (isLow || !parts) {
            (["addressStreet", "addressComplement", "postalCode", "city", "country"] as const).forEach((addressKey) => lowConfidence.add(addressKey))
          }
        }
        break
      case "guardianFullName":
        setText("guardianName", extracted)
        break
      case "guardianPhone":
        setText("guardianPhone", extracted)
        break
      case "secondGuardianFullName":
        setText("secondGuardianName", extracted)
        break
      case "secondGuardianPhone":
        setText("secondGuardianPhone", extracted)
        break
      case "imageRights":
        if (draft.imageRights === "unknown" && typeof extracted.value === "boolean") {
          draft.imageRights = extracted.value ? "yes" : "no"
          if (isLow) lowConfidence.add("imageRights")
        }
        break
      case "legalDocument":
        if (field.legalDocumentId && extracted.value === true && !draft.acceptedLegalDocumentIds.includes(field.legalDocumentId)) {
          draft.acceptedLegalDocumentIds.push(field.legalDocumentId)
        }
        if (field.legalDocumentId && isLow) lowConfidence.add(`legal:${field.legalDocumentId}`)
        // Reaching here means the box's page was read (a missing page leaves no value at
        // all), so the answer belongs in the notes — even unticked or unreadable.
        if (field.legalDocumentId && !legalDocumentNoteLines.some((noteLine) => noteLine.legalDocumentId === field.legalDocumentId)) {
          legalDocumentNoteLines.push({
            legalDocumentId: field.legalDocumentId,
            acceptedLine:    `${field.label} : ${labels.booleans.yes}`,
            declinedLine:    `${field.label} : ${labels.booleans.no}`,
          })
        }
        break
      case "notes":
        if (isFilled(extracted)) {
          noteLines.push(`${field.label} : ${describeForNotes(extracted, labels.booleans)}`)
          if (isLow) lowConfidence.add("notes")
        }
        break
      case "ignore":
        break
    }
  }

  if (names.student) {
    draft.firstName = names.student.firstName
    draft.lastName  = names.student.lastName
    if (names.student.lowConfidence) { lowConfidence.add("firstName"); lowConfidence.add("lastName") }
  }

  draft.notes = noteLines.join("\n")
  return { draft, lowConfidence: [...lowConfidence], legalDocumentNoteLines }
}

export function buildForms(
  pages: ScanPage[],
  template: PaperFormTemplateResponse,
  labels: DraftBuildLabels,
): ScanForm[] {
  const groupablePages = pages.filter((page) => !isRefusedPage(page))
  const pagesById = new Map(groupablePages.map((page) => [page.pageId, page]))
  return groupPagesIntoForms(groupablePages, template.pagesPerForm).map((pageSlots, formIndex) => {
    const pagesInOrder = pageSlots.flatMap((pageId) => {
      const page = pageId ? pagesById.get(pageId) : undefined
      return page ? [page] : []
    })
    const { draft, lowConfidence, legalDocumentNoteLines } = buildDraft(template.fields, mergePageValues(pagesInOrder), labels)
    return {
      formId: `form-${formIndex + 1}`,
      pageSlots,
      draft,
      lowConfidence,
      status: "toReview",
      errorMessage: null,
      membreId: null,
      skippedLegalDocumentIds: [],
      studentDuplicates: null,
      legalDocumentNoteLines,
    }
  })
}

// ─── Review helpers ──────────────────────────────────────────────────────────────────────

export function fullNameOf(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim()
}

// Age at today's date from a YYYY-MM-DD birth date; null when absent or malformed.
export function ageFromBirthDate(birthDate: string, today = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate)
  if (!match) return null
  const [, yearText, monthText, dayText] = match
  const birthYear = Number(yearText), birthMonth = Number(monthText), birthDay = Number(dayText)
  let age = today.getFullYear() - birthYear
  const birthdayNotReached = today.getMonth() + 1 < birthMonth || (today.getMonth() + 1 === birthMonth && today.getDate() < birthDay)
  if (birthdayNotReached) age -= 1
  return age >= 0 && age < 130 ? age : null
}

export function hasGuardianInput(draft: ReviewDraft): boolean {
  return [draft.guardianName, draft.guardianPhone, draft.secondGuardianName, draft.secondGuardianPhone]
    .some((value) => value.trim() !== "")
}

// Draft field → message, from the same zod schema the commit route applies: one invalid
// email in a batch would otherwise refuse the whole request, so every form is checked here
// before it can be validated. A missing page is not an error: a phone photo of page 2 may
// simply not have been taken, and the manager decides with the warning (hasMissingPage).
export type DraftErrors = Partial<Record<keyof ReviewDraft | keyof AddressFormValues, string>>

export type ValidationMessages = {
  firstNameRequired: string
  lastNameRequired:  string
}

const STUDENT_PATH_TO_DRAFT_KEY: Record<string, keyof ReviewDraft | keyof AddressFormValues> = {
  firstName: "firstName", lastName: "lastName", email: "email", phone: "phone", birthDate: "birthDate",
  civilite: "civilite", sexe: "sexe", addressStreet: "addressStreet", addressComplement: "addressComplement",
  postalCode: "postalCode", city: "city", country: "country",
}

const GUARDIAN_PATH_TO_DRAFT_KEY: Record<string, keyof ReviewDraft> = {
  name: "guardianName", phone: "guardianPhone",
}

const SECOND_GUARDIAN_PATH_TO_DRAFT_KEY: Record<string, keyof ReviewDraft> = {
  name: "secondGuardianName", phone: "secondGuardianPhone",
}

export function validateForm(form: ScanForm, messages: ValidationMessages): DraftErrors {
  const errors: DraftErrors = {}
  const { draft } = form

  if (!draft.firstName.trim()) errors.firstName = messages.firstNameRequired
  if (!draft.lastName.trim())  errors.lastName  = messages.lastNameRequired

  const parsed = paperFormCommitFormSchema.safeParse(toCommitForm(form))
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const [section, fieldName] = issue.path.map(String)
      const draftKey =
        section === "student"  ? STUDENT_PATH_TO_DRAFT_KEY[fieldName] :
        section === "guardian"       ? GUARDIAN_PATH_TO_DRAFT_KEY[fieldName] :
        section === "secondGuardian" ? SECOND_GUARDIAN_PATH_TO_DRAFT_KEY[fieldName] :
        section === "notes"    ? "notes" :
        undefined
      if (draftKey && !errors[draftKey]) errors[draftKey] = issue.message
    }
  }
  return errors
}

export function hasErrors(errors: DraftErrors): boolean {
  return Object.keys(errors).length > 0
}

// ─── Commit payload ──────────────────────────────────────────────────────────────────────

export type CommitStudent  = PaperFormCommitStudent
export type CommitGuardian = PaperFormCommitForm["guardian"]
export type CommitForm     = PaperFormCommitForm

function optionalText(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

// A responsable with neither a name nor a phone is simply absent.
function toCommitGuardian(name: string, phone: string): CommitGuardian {
  const trimmedName  = name.trim()
  const trimmedPhone = phone.trim()
  if (!trimmedName && !trimmedPhone) return null
  return { name: trimmedName || null, phone: trimmedPhone || null }
}

// The manager's notes, then one line per linked acceptance box read on the sheet, worded
// from the final checkbox — the same state the acceptances are recorded from.
function composeCommitNotes(form: ScanForm): string | null {
  const { draft } = form
  const legalLines = form.legalDocumentNoteLines.map((noteLine) =>
    draft.acceptedLegalDocumentIds.includes(noteLine.legalDocumentId) ? noteLine.acceptedLine : noteLine.declinedLine,
  )
  return optionalText([draft.notes.trim(), ...legalLines].filter((line) => line !== "").join("\n")) ?? null
}

export function toCommitForm(form: ScanForm): CommitForm {
  const { draft } = form
  const student: CommitStudent = {
    firstName:         draft.firstName.trim(),
    lastName:          draft.lastName.trim(),
    email:             optionalText(draft.email),
    phone:             optionalText(draft.phone),
    birthDate:         /^\d{4}-\d{2}-\d{2}$/.test(draft.birthDate) ? draft.birthDate : undefined,
    civilite:          draft.civilite || undefined,
    sexe:              draft.sexe || undefined,
    addressStreet:     optionalText(draft.address.addressStreet),
    addressComplement: optionalText(draft.address.addressComplement),
    postalCode:        optionalText(draft.address.postalCode),
    city:              optionalText(draft.address.city),
    country:           optionalText(draft.address.country),
  }

  return {
    ref:                      form.formId,
    student,
    guardian:                 toCommitGuardian(draft.guardianName, draft.guardianPhone),
    secondGuardian:           toCommitGuardian(draft.secondGuardianName, draft.secondGuardianPhone),
    notes:                    composeCommitNotes(form),
    imageRights:              draft.imageRights === "unknown" ? null : draft.imageRights === "yes",
    acceptedLegalDocumentIds: draft.acceptedLegalDocumentIds,
  }
}
