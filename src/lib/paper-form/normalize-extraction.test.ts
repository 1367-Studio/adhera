import { describe, expect, it } from "vitest"
import { CHECKBOX_NOTES_HINT, normalizeProposedFields } from "@/lib/paper-form/normalize-extraction"

const KNOWN_DOCUMENT_IDS = new Set(["doc_reglement"])

describe("normalizeProposedFields", () => {
  it("keeps a commitment box linked to a known document as legalDocument", () => {
    const { fields, droppedFieldCount } = normalizeProposedFields(
      { fields: [{ key: "reglement_interieur", label: "Règlement Intérieur", page: 2, target: "legalDocument", legalDocumentId: "doc_reglement", hint: "Case d'acceptation." }] },
      2,
      KNOWN_DOCUMENT_IDS,
    )
    expect(droppedFieldCount).toBe(0)
    expect(fields).toEqual([
      { key: "reglement_interieur", label: "Règlement Intérieur", page: 2, target: "legalDocument", legalDocumentId: "doc_reglement", hint: "Case d'acceptation." },
    ])
  })

  // An unknown or missing document id must not lose the box: it is still read, as a
  // « Oui » / « Non » answer kept in the notes.
  it.each([
    ["an unknown document id", "doc_inexistant"],
    ["no document id", undefined],
  ])("degrades a commitment box with %s to a Oui/Non notes field", (_caseName, legalDocumentId) => {
    const { fields, droppedFieldCount } = normalizeProposedFields(
      { fields: [{ key: "engagement_financier", label: "Engagement Financier", page: 2, target: "legalDocument", legalDocumentId, hint: "Cochée ou non." }] },
      2,
      KNOWN_DOCUMENT_IDS,
    )
    expect(droppedFieldCount).toBe(0)
    expect(fields).toEqual([
      { key: "engagement_financier", label: "Engagement Financier", page: 2, target: "notes", hint: CHECKBOX_NOTES_HINT },
    ])
  })

  it("keeps a full two-page proposal with long hints, without truncating it", () => {
    const longHint = "Modes cochés parmi Espèces, CB, Chèque, Virement, ANCV, Pass'sport, Autre, chacun avec le montant écrit à côté, séparés par « ; » (ex. « CB 100 € ; ANCV 50 € »)."
    const proposedFields = Array.from({ length: 30 }, (_unused, fieldIndex) => ({
      key:    `champ_${fieldIndex + 1}`,
      label:  `Champ ${fieldIndex + 1}`,
      page:   fieldIndex < 15 ? 1 : 2,
      target: "notes",
      hint:   longHint,
    }))
    const { fields, droppedFieldCount } = normalizeProposedFields({ fields: proposedFields }, 2, KNOWN_DOCUMENT_IDS)
    expect(droppedFieldCount).toBe(0)
    expect(fields).toHaveLength(30)
    expect(fields.every((field) => field.hint === longHint)).toBe(true)
  })

  it("drops a field on a page beyond the form and an unknown target", () => {
    const { fields, droppedFieldCount } = normalizeProposedFields(
      { fields: [
        { key: "total_a_regler", label: "Total à régler", page: 3, target: "notes" },
        { key: "mystere", label: "Mystère", page: 1, target: "inconnu" },
        { key: "signature", label: "Signature", page: 2, target: "notes" },
      ] },
      2,
      KNOWN_DOCUMENT_IDS,
    )
    expect(droppedFieldCount).toBe(2)
    expect(fields.map((field) => field.key)).toEqual(["signature"])
  })
})
