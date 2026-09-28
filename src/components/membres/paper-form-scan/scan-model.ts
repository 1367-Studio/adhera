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
  // Answers of the sheet fields without a member column (see SheetField), by field key:
  // a boolean for a checkbox, the text for a text field. Linked acceptance boxes are not
  // here: acceptedLegalDocumentIds is their single source of truth.
  sheetAnswers:             Record<string, boolean | string>
  // The manager's own notes only — the sheet answers are appended at commit time.
  notes:                    string
}

// Draft keys read with low confidence, plus `legal:<documentId>` for acceptance boxes,
// `sheet:<fieldKey>` for a sheet answer read with low confidence and `unread:<fieldKey>` for
// a sheet box whose page was read but whose state could not be (shown unticked, to check).
export type LowConfidenceKey =
  | keyof ReviewDraft
  | keyof AddressFormValues
  | `legal:${string}`
  | `sheet:${string}`
  | `unread:${string}`

export type DuplicateMatch = PaperFormDuplicateMatch

// A template field with no member column (target `notes`, or `legalDocument`), shown in the
// review as it is on the sheet — a box or a text — and written to the member's notes at
// creation (« libellé : valeur »). Offline acceptances only surface in the per-document CSV
// export, so the notes also keep the linked boxes' answer where the manager looks.
export type SheetFieldKind = "checkbox" | "text" | "longText"

export type SheetField = {
  key:              string
  label:            string
  page:             number
  kind:             SheetFieldKind
  // Set on an acceptance box linked to a legal document (always a checkbox).
  legalDocumentId?: string
}

export type BooleanLabels = { yes: string; no: string }

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
  // Same list for every form of the batch, in template order (see buildSheetFields).
  sheetFields:      SheetField[]
  // « Oui » / « Non » as written in the notes, resolved once when the forms are built.
  booleanLabels:    BooleanLabels
}

// A page counts as present when a page of the batch fills its slot; its sheet answers are
// then shown and written to the notes. A missing page has no answer at all.
export function isPagePresent(pageSlots: (string | null)[], pageNumber: number): boolean {
  return (pageSlots[pageNumber - 1] ?? null) !== null
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
  imageRights: "unknown", acceptedLegalDocumentIds: [], sheetAnswers: {}, notes: "",
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

export type DraftBuildLabels = {
  booleans: BooleanLabels
}

// ─── Sheet fields ────────────────────────────────────────────────────────────────────────

const YES_NO_PATTERN = /^\s*(oui|non|yes|no)\s*$/i
const YES_PATTERN    = /^\s*(oui|yes)\s*$/i
// A text answer longer than this (or a list separated by « ; ») gets a textarea.
const LONG_TEXT_MIN_LENGTH = 60

// A box answer: a boolean reading, or a text reading « Oui » / « Non ». Null otherwise.
function yesNoOf(extracted: PaperFormExtractedValue | undefined): boolean | null {
  if (!extracted || extracted.value === null) return null
  if (typeof extracted.value === "boolean") return extracted.value
  return YES_NO_PATTERN.test(extracted.value) ? YES_PATTERN.test(extracted.value) : null
}

// Decided once for the whole batch, so a field looks the same on every form: a box when
// every filled reading is a yes/no (at least one), a textarea when a reading is long or a
// list, else a one-line input. Unread or empty readings do not count against a box.
function inferNotesFieldKind(readings: (PaperFormExtractedValue | undefined)[]): SheetFieldKind {
  const filledReadings = readings.filter(isFilled)
  if (filledReadings.length === 0) return "text"
  if (filledReadings.every((reading) => yesNoOf(reading) !== null)) return "checkbox"
  const hasLongReading = filledReadings.some((reading) =>
    typeof reading.value === "string" && (reading.value.trim().length > LONG_TEXT_MIN_LENGTH || reading.value.includes(";")),
  )
  return hasLongReading ? "longText" : "text"
}

// Every `notes` and `legalDocument` field of the template, in template order. Several boxes
// may point at one legal document: the first one stands for it (one checkbox per document).
export function buildSheetFields(
  fields: PaperFormField[],
  mergedValuesPerForm: Record<string, PaperFormExtractedValue>[],
): SheetField[] {
  const sheetFields: SheetField[] = []
  for (const field of fields) {
    if (field.target === "legalDocument") {
      const legalDocumentId = field.legalDocumentId
      if (!legalDocumentId || sheetFields.some((sheetField) => sheetField.legalDocumentId === legalDocumentId)) continue
      sheetFields.push({ key: field.key, label: field.label, page: field.page, kind: "checkbox", legalDocumentId })
    } else if (field.target === "notes") {
      const readings = mergedValuesPerForm.map((mergedValues) => mergedValues[field.key])
      sheetFields.push({ key: field.key, label: field.label, page: field.page, kind: inferNotesFieldKind(readings) })
    }
  }
  return sheetFields
}

// ─── Draft ───────────────────────────────────────────────────────────────────────────────

export type DraftBuildContext = {
  labels:      DraftBuildLabels
  sheetFields: SheetField[]
  pageSlots:   (string | null)[]
}

export function buildDraft(
  fields: PaperFormField[],
  mergedValues: Record<string, PaperFormExtractedValue>,
  context: DraftBuildContext,
): { draft: ReviewDraft; lowConfidence: LowConfidenceKey[] } {
  const draft: ReviewDraft = { ...EMPTY_DRAFT, address: { ...EMPTY_ADDRESS_FORM_VALUES }, acceptedLegalDocumentIds: [], sheetAnswers: {} }
  const lowConfidence = new Set<LowConfidenceKey>()

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
        break
      // Sheet answers, handled below from the sheet fields.
      case "notes":
      case "ignore":
        break
    }
  }

  if (names.student) {
    draft.firstName = names.student.firstName
    draft.lastName  = names.student.lastName
    if (names.student.lowConfidence) { lowConfidence.add("firstName"); lowConfidence.add("lastName") }
  }

  // Sheet answers of the pages present. The notes textarea starts empty: it holds the
  // manager's own notes, the answers are appended at commit time (composeCommitNotes).
  const { booleans } = context.labels
  for (const sheetField of context.sheetFields) {
    if (!isPagePresent(context.pageSlots, sheetField.page)) continue

    const legalDocumentId = sheetField.legalDocumentId
    if (legalDocumentId) {
      // Ticked state already in acceptedLegalDocumentIds; unread when no box of the
      // document gave a state.
      const hasReadBox = fields.some((field) =>
        field.target === "legalDocument" && field.legalDocumentId === legalDocumentId && typeof mergedValues[field.key]?.value === "boolean",
      )
      if (!hasReadBox) lowConfidence.add(`unread:${sheetField.key}`)
      continue
    }

    const extracted = mergedValues[sheetField.key]
    const isLow = extracted?.confidence === "low"
    if (sheetField.kind === "checkbox") {
      const answer = yesNoOf(extracted)
      draft.sheetAnswers[sheetField.key] = answer ?? false
      if (answer === null) lowConfidence.add(`unread:${sheetField.key}`)
      if (isLow) lowConfidence.add(`sheet:${sheetField.key}`)
    } else {
      const answerText = typeof extracted?.value === "boolean"
        ? (extracted.value ? booleans.yes : booleans.no)
        : textOf(extracted)
      draft.sheetAnswers[sheetField.key] = answerText
      if (isLow && answerText !== "") lowConfidence.add(`sheet:${sheetField.key}`)
    }
  }

  return { draft, lowConfidence: [...lowConfidence] }
}

export function buildForms(
  pages: ScanPage[],
  template: PaperFormTemplateResponse,
  labels: DraftBuildLabels,
): ScanForm[] {
  const groupablePages = pages.filter((page) => !isRefusedPage(page))
  const pagesById = new Map(groupablePages.map((page) => [page.pageId, page]))
  const groupedForms = groupPagesIntoForms(groupablePages, template.pagesPerForm).map((pageSlots) => {
    const pagesInOrder = pageSlots.flatMap((pageId) => {
      const page = pageId ? pagesById.get(pageId) : undefined
      return page ? [page] : []
    })
    return { pageSlots, mergedValues: mergePageValues(pagesInOrder) }
  })
  const sheetFields = buildSheetFields(template.fields, groupedForms.map((groupedForm) => groupedForm.mergedValues))

  return groupedForms.map(({ pageSlots, mergedValues }, formIndex) => {
    const { draft, lowConfidence } = buildDraft(template.fields, mergedValues, { labels, sheetFields, pageSlots })
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
      sheetFields,
      booleanLabels: labels.booleans,
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

// The value a sheet field leaves in the notes, null for no line: a missing page, an empty
// text, or a box still unread (never confirmed by the manager). Boxes are worded from the
// final checkbox — for a linked one, the same state the acceptance is recorded from — so a
// box ticked or unticked in review can never leave a contradicting line.
function sheetAnswerForNotes(form: ScanForm, sheetField: SheetField): string | null {
  const { draft } = form
  if (!isPagePresent(form.pageSlots, sheetField.page)) return null
  if (sheetField.kind === "checkbox") {
    if (form.lowConfidence.includes(`unread:${sheetField.key}`)) return null
    const isTicked = sheetField.legalDocumentId
      ? draft.acceptedLegalDocumentIds.includes(sheetField.legalDocumentId)
      : draft.sheetAnswers[sheetField.key] === true
    return isTicked ? form.booleanLabels.yes : form.booleanLabels.no
  }
  const answer = draft.sheetAnswers[sheetField.key]
  return typeof answer === "string" && answer.trim() !== "" ? answer.trim() : null
}

// The manager's notes, then one « libellé : valeur » line per sheet answer, template order.
export function composeCommitNotes(form: ScanForm): string | null {
  const answerLines = form.sheetFields.flatMap((sheetField) => {
    const answer = sheetAnswerForNotes(form, sheetField)
    return answer === null ? [] : [`${sheetField.label} : ${answer}`]
  })
  return optionalText([form.draft.notes.trim(), ...answerLines].filter((line) => line !== "").join("\n")) ?? null
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
