import { describe, expect, it } from "vitest"
import { normalizeExtraction } from "@/lib/paper-form/normalize-extraction"
import type { PaperFormField, PaperFormTemplateResponse } from "@/lib/schemas/paper-form"
import {
  EMPTY_DRAFT,
  buildDraft,
  buildForms,
  groupPagesIntoForms,
  hasMissingPage,
  toCommitForm,
  validateForm,
  type CapturedSlot,
  type ScanForm,
  type ScanPage,
  type ScanPageStatus,
  type ValidationMessages,
} from "./scan-model"

const PAGES_PER_FORM = 2

type PageOptions = {
  printedPageNumber?: number | null
  capturedSlot?:      CapturedSlot | null
  status?:            ScanPageStatus
}

// Page number N of the batch: id `page-N`, upload index N - 1, as the wizard numbers them.
function buildPage(pageNumberInBatch: number, options: PageOptions = {}): ScanPage {
  const { printedPageNumber = null, capturedSlot = null, status = "done" } = options
  return {
    pageId:        `page-${pageNumberInBatch}`,
    uploadIndex:   pageNumberInBatch - 1,
    sourceFileId:  `file-${pageNumberInBatch}`,
    sourceName:    `scan-${pageNumberInBatch}.jpg`,
    previewUrl:    "",
    width:         1000,
    height:        1400,
    status,
    error:         null,
    result:        status === "done" ? { pageNumber: printedPageNumber, values: {} } : null,
    detectedTitle: null,
    capturedSlot,
  }
}

function buildUploadedPages(printedPageNumbers: (number | null)[]): ScanPage[] {
  return printedPageNumbers.map((printedPageNumber, pageIndex) => buildPage(pageIndex + 1, { printedPageNumber }))
}

describe("groupPagesIntoForms — uploaded pages (legacy behaviour, unchanged)", () => {
  it("pairs pages printed 1, 2, 1, 2 into two forms", () => {
    expect(groupPagesIntoForms(buildUploadedPages([1, 2, 1, 2]), PAGES_PER_FORM)).toEqual([
      ["page-1", "page-2"],
      ["page-3", "page-4"],
    ])
  })

  it("fills unnumbered pages sequentially, starting a new form when one is full", () => {
    expect(groupPagesIntoForms(buildUploadedPages([null, null, null]), PAGES_PER_FORM)).toEqual([
      ["page-1", "page-2"],
      ["page-3", null],
    ])
  })

  it("groups pages printed 1, 1, 2, 2 exactly as before (snapshot of the legacy output)", () => {
    expect(groupPagesIntoForms(buildUploadedPages([1, 1, 2, 2]), PAGES_PER_FORM)).toEqual([
      ["page-1", null],
      ["page-2", "page-3"],
      [null, "page-4"],
    ])
  })

  it("orders by upload index, not by array order", () => {
    const [firstPage, secondPage] = buildUploadedPages([1, 2])
    expect(groupPagesIntoForms([secondPage, firstPage], PAGES_PER_FORM)).toEqual([["page-1", "page-2"]])
  })

  it("skips refused pages: they neither start a form nor fill a slot", () => {
    const pages = [
      buildPage(1, { printedPageNumber: 1 }),
      buildPage(2, { status: "refused" }),
      buildPage(3, { printedPageNumber: 1 }),
      buildPage(4, { printedPageNumber: 2 }),
    ]
    expect(groupPagesIntoForms(pages, PAGES_PER_FORM)).toEqual([
      ["page-1", null],
      ["page-3", "page-4"],
    ])
  })
})

describe("groupPagesIntoForms — captured pages", () => {
  it("places each photo in the slot it was tagged with, ignoring the printed number", () => {
    const pages = [
      buildPage(1, { capturedSlot: { formNumber: 1, pageNumber: 2 }, printedPageNumber: 1 }),
      buildPage(2, { capturedSlot: { formNumber: 2, pageNumber: 1 } }),
      buildPage(3, { capturedSlot: { formNumber: 1, pageNumber: 1 }, printedPageNumber: null }),
      buildPage(4, { capturedSlot: { formNumber: 2, pageNumber: 2 } }),
    ]
    expect(groupPagesIntoForms(pages, PAGES_PER_FORM)).toEqual([
      ["page-3", "page-1"],
      ["page-2", "page-4"],
    ])
  })

  it("keeps a missing captured page as an empty slot", () => {
    const pages = [buildPage(1, { capturedSlot: { formNumber: 1, pageNumber: 1 } })]
    expect(groupPagesIntoForms(pages, PAGES_PER_FORM)).toEqual([["page-1", null]])
  })

  it("never drops a page when two photos claim the same slot: the later one starts a new form", () => {
    const pages = [
      buildPage(1, { capturedSlot: { formNumber: 1, pageNumber: 1 } }),
      buildPage(2, { capturedSlot: { formNumber: 1, pageNumber: 1 } }),
      buildPage(3, { capturedSlot: { formNumber: 1, pageNumber: 2 } }),
    ]
    expect(groupPagesIntoForms(pages, PAGES_PER_FORM)).toEqual([
      ["page-1", null],
      ["page-2", "page-3"],
    ])
  })

  it("skips refused captured pages", () => {
    const pages = [
      buildPage(1, { capturedSlot: { formNumber: 1, pageNumber: 1 } }),
      buildPage(2, { capturedSlot: { formNumber: 1, pageNumber: 2 }, status: "refused" }),
    ]
    expect(groupPagesIntoForms(pages, PAGES_PER_FORM)).toEqual([["page-1", null]])
  })

  it("places a photo tagged beyond the template's pages like an uploaded page", () => {
    const pages = [buildPage(1, { capturedSlot: { formNumber: 1, pageNumber: 3 }, printedPageNumber: 2 })]
    expect(groupPagesIntoForms(pages, PAGES_PER_FORM)).toEqual([[null, "page-1"]])
  })
})

describe("groupPagesIntoForms — captured and uploaded pages together", () => {
  it("never lets an uploaded page fill a captured form's empty slot", () => {
    const pages = [
      buildPage(1, { capturedSlot: { formNumber: 1, pageNumber: 1 } }),
      buildPage(2, { printedPageNumber: 2 }),
      buildPage(3, { printedPageNumber: null }),
    ]
    expect(groupPagesIntoForms(pages, PAGES_PER_FORM)).toEqual([
      ["page-1", null],
      [null, "page-2"],
      ["page-3", null],
    ])
  })

  it("keeps the uploaded pages' own current form across captured photos", () => {
    const pages = [
      buildPage(1, { printedPageNumber: 1 }),
      buildPage(2, { capturedSlot: { formNumber: 1, pageNumber: 1 } }),
      buildPage(3, { printedPageNumber: 2 }),
      buildPage(4, { capturedSlot: { formNumber: 1, pageNumber: 2 } }),
    ]
    expect(groupPagesIntoForms(pages, PAGES_PER_FORM)).toEqual([
      ["page-1", "page-3"],
      ["page-2", "page-4"],
    ])
  })
})

describe("validateForm — missing page", () => {
  const messages: ValidationMessages = { firstNameRequired: "Prénom requis", lastNameRequired: "Nom requis" }

  function buildForm(pageSlots: (string | null)[]): ScanForm {
    return {
      formId:                  "form-1",
      pageSlots,
      draft:                   { ...EMPTY_DRAFT, firstName: "Jeanne", lastName: "Martin" },
      lowConfidence:           [],
      status:                  "toReview",
      errorMessage:            null,
      membreId:                null,
      skippedLegalDocumentIds: [],
      studentDuplicates:       null,
      legalDocumentNoteLines:  [],
    }
  }

  it("is a warning only: a form with a missing page has no validation error", () => {
    const form = buildForm(["page-1", null])
    expect(hasMissingPage(form)).toBe(true)
    expect(validateForm(form, messages)).toEqual({})
  })

  it("still requires the names", () => {
    const form = { ...buildForm(["page-1", null]), draft: { ...EMPTY_DRAFT } }
    expect(validateForm(form, messages)).toEqual({ firstName: "Prénom requis", lastName: "Nom requis" })
  })
})

describe("normalizeExtraction — page number", () => {
  const fields: PaperFormField[] = [
    { key: "prenom",   label: "Prénom",   page: 1, target: "firstName" },
    { key: "reglement", label: "Règlement", page: 2, target: "notes" },
  ]
  const answerWithBothPages = {
    pageNumber: 1,
    values: {
      prenom:    { value: "Jeanne", confidence: "high" },
      reglement: { value: "Chèque", confidence: "high" },
    },
  }

  it("keeps the printed page number and drops other pages' fields without expectedPageNumber", () => {
    expect(normalizeExtraction(answerWithBothPages, fields, PAGES_PER_FORM)).toEqual({
      pageNumber: 1,
      values:     { prenom: { value: "Jeanne", confidence: "high" } },
    })
  })

  it("reads no page number when none is printed and none is expected", () => {
    const result = normalizeExtraction({ ...answerWithBothPages, pageNumber: null }, fields, PAGES_PER_FORM)
    expect(result.pageNumber).toBeNull()
    expect(Object.keys(result.values)).toEqual(["prenom", "reglement"])
  })

  it("lets the expected page number outrank the printed one", () => {
    expect(normalizeExtraction(answerWithBothPages, fields, PAGES_PER_FORM, 2)).toEqual({
      pageNumber: 2,
      values:     { reglement: { value: "Chèque", confidence: "high" } },
    })
  })

  it("uses the expected page number when the printed one is not visible", () => {
    const result = normalizeExtraction({ ...answerWithBothPages, pageNumber: null }, fields, PAGES_PER_FORM, 1)
    expect(result.pageNumber).toBe(1)
    expect(Object.keys(result.values)).toEqual(["prenom"])
  })

  it("ignores an expected page number beyond the form", () => {
    expect(normalizeExtraction(answerWithBothPages, fields, PAGES_PER_FORM, 3).pageNumber).toBe(1)
  })
})

describe("legal document boxes — notes on the member file", () => {
  const draftLabels = { booleans: { yes: "Oui", no: "Non" } }
  const fields: PaperFormField[] = [
    { key: "nom_prenom",          label: "Nom - Prénom",         page: 1, target: "fullName" },
    { key: "forfait",             label: "Forfait",              page: 1, target: "notes" },
    { key: "engagement_financier", label: "Engagement Financier", page: 2, target: "legalDocument", legalDocumentId: "document-financier" },
    { key: "reglement_interieur",  label: "Règlement Intérieur",  page: 2, target: "legalDocument", legalDocumentId: "document-reglement" },
    { key: "mediation",           label: "Médiation",            page: 2, target: "notes" },
  ]
  const template: PaperFormTemplateResponse = {
    id: "template-1", name: "Fiche", pagesPerForm: PAGES_PER_FORM, fields, identificationText: null,
    createdAt: "2026-09-28T00:00:00.000Z", updatedAt: "2026-09-28T00:00:00.000Z",
  }

  function buildReadPage(pageNumberInBatch: number, printedPageNumber: number, values: NonNullable<ScanPage["result"]>["values"]): ScanPage {
    const page = buildPage(pageNumberInBatch, { printedPageNumber })
    return { ...page, result: { pageNumber: printedPageNumber, values } }
  }

  const pageOne = buildReadPage(1, 1, {
    nom_prenom: { value: "MARTIN Jeanne", firstName: "Jeanne", lastName: "Martin", confidence: "high" },
    forfait:    { value: "2 Cours", confidence: "high" },
  })
  const pageTwo = buildReadPage(2, 2, {
    engagement_financier: { value: true,  confidence: "high" },
    reglement_interieur:  { value: false, confidence: "low" },
    mediation:            { value: "Oui", confidence: "high" },
  })

  it("records a ticked box as an acceptance only, and keeps the draft notes free of legal lines", () => {
    const { draft, lowConfidence, legalDocumentNoteLines } = buildDraft(fields, {
      engagement_financier: { value: true,  confidence: "high" },
      reglement_interieur:  { value: false, confidence: "low" },
    }, draftLabels)
    expect(draft.acceptedLegalDocumentIds).toEqual(["document-financier"])
    expect(draft.notes).toBe("")
    expect(lowConfidence).toEqual(["legal:document-reglement"])
    expect(legalDocumentNoteLines).toEqual([
      { legalDocumentId: "document-financier", acceptedLine: "Engagement Financier : Oui", declinedLine: "Engagement Financier : Non" },
      { legalDocumentId: "document-reglement", acceptedLine: "Règlement Intérieur : Oui",  declinedLine: "Règlement Intérieur : Non" },
    ])
  })

  it("adds one line per linked box read on the sheet to the committed notes, ticked or not", () => {
    const [form] = buildForms([pageOne, pageTwo], template, draftLabels)
    expect(toCommitForm(form).notes).toBe(
      "Forfait : 2 Cours\nMédiation : Oui\nEngagement Financier : Oui\nRèglement Intérieur : Non",
    )
    expect(toCommitForm(form).acceptedLegalDocumentIds).toEqual(["document-financier"])
  })

  it("words the line from the reviewed checkbox, so a box changed in review never contradicts it", () => {
    const [form] = buildForms([pageOne, pageTwo], template, draftLabels)
    const reviewedForm: ScanForm = { ...form, draft: { ...form.draft, acceptedLegalDocumentIds: ["document-reglement"] } }
    expect(toCommitForm(reviewedForm).notes).toBe(
      "Forfait : 2 Cours\nMédiation : Oui\nEngagement Financier : Non\nRèglement Intérieur : Oui",
    )
  })

  it("adds no line for the boxes of a missing page", () => {
    const [form] = buildForms([pageOne], template, draftLabels)
    expect(form.legalDocumentNoteLines).toEqual([])
    expect(toCommitForm(form).notes).toBe("Forfait : 2 Cours")
  })

  it("keeps the legal lines when the manager cleared the notes", () => {
    const [form] = buildForms([pageOne, pageTwo], template, draftLabels)
    const clearedForm: ScanForm = { ...form, draft: { ...form.draft, notes: "  " } }
    expect(toCommitForm(clearedForm).notes).toBe("Engagement Financier : Oui\nRèglement Intérieur : Non")
  })

  it("sends null notes when there is nothing to record", () => {
    const [form] = buildForms([buildReadPage(1, 1, {})], template, draftLabels)
    expect(toCommitForm(form).notes).toBeNull()
  })
})
