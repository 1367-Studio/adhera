import { describe, expect, it } from "vitest"
import { hasConditionsText, isTermsConfigurationValid, normalizeConditions, publicFormTerms } from "@/lib/form-terms"

const pdf = { url: "https://files.example.org/cgv.pdf", filename: "cgv.pdf", size: 1200 }

describe("hasConditionsText", () => {
  // The live bug (FORM-22): an emptied editor saved "<p></p><p></p>" and the donation form
  // rendered a second, empty "Conditions" block.
  it("treats emptied editor markup as no text", () => {
    expect(hasConditionsText("<p></p><p></p>")).toBe(false)
    expect(hasConditionsText("<p>&nbsp;</p>")).toBe(false)
    expect(hasConditionsText("<p> </p><br>")).toBe(false)
    expect(hasConditionsText(null)).toBe(false)
  })

  it("sees real text", () => {
    expect(hasConditionsText("<p>Aucun remboursement.</p>")).toBe(true)
  })
})

describe("isTermsConfigurationValid", () => {
  it("rejects a required acceptance with nothing to accept", () => {
    expect(isTermsConfigurationValid({ conditions: "<p></p>", attachments: [], requireCguvSignature: true })).toBe(false)
  })

  it("accepts text only, document only, or both", () => {
    expect(isTermsConfigurationValid({ conditions: "<p>Texte</p>", attachments: [], requireCguvSignature: true })).toBe(true)
    expect(isTermsConfigurationValid({ conditions: null, attachments: [pdf], requireCguvSignature: true })).toBe(true)
    expect(isTermsConfigurationValid({ conditions: "<p>Texte</p>", attachments: [pdf], requireCguvSignature: true })).toBe(true)
  })

  it("never blocks when acceptance is optional", () => {
    expect(isTermsConfigurationValid({ conditions: null, attachments: null, requireCguvSignature: false })).toBe(true)
  })
})

describe("publicFormTerms", () => {
  it("drops the empty text but keeps the document and the required checkbox", () => {
    expect(publicFormTerms({ conditions: "<p></p><p></p>", attachments: [pdf], requireCguvSignature: true }))
      .toEqual({ conditions: null, attachments: [pdf], requiresTermsAcceptance: true })
  })

  it("does not demand consent to nothing on a form saved before the rule", () => {
    expect(publicFormTerms({ conditions: "<p></p>", attachments: null, requireCguvSignature: true }))
      .toEqual({ conditions: null, attachments: [], requiresTermsAcceptance: false })
  })
})

describe("normalizeConditions", () => {
  it("stores null instead of empty markup", () => {
    expect(normalizeConditions("<p></p><p></p>")).toBeNull()
    expect(normalizeConditions("<p>Texte</p>")).toBe("<p>Texte</p>")
  })
})
