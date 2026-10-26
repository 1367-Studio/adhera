import { describe, expect, it } from "vitest"
import { buildCsv } from "@/lib/csv"

describe("buildCsv", () => {
  it("starts with a UTF-8 BOM, separates with semicolons and ends lines with CRLF", () => {
    expect(buildCsv([["Participant", "Montant"], ["Zoé", "30,00"]])).toBe('﻿"Participant";"Montant"\r\n"Zoé";"30,00"\r\n')
  })

  it("escapes quotes and leaves empty cells empty", () => {
    expect(buildCsv([['Dit "bonjour"', null, undefined, 5]])).toBe('﻿"Dit ""bonjour""";"";"";"5"\r\n')
  })

  it("neutralizes cells Excel would run as formulas", () => {
    expect(buildCsv([["=HYPERLINK(1)", "+33 6", "@me", "-1"]])).toBe(`﻿"'=HYPERLINK(1)";"'+33 6";"'@me";"'-1"\r\n`)
  })
})
