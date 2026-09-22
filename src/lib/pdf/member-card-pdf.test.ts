import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib"
import { CARD_CONTACT_MAX_WIDTH_MM, CARD_FONT_FOOTER_MM } from "@/lib/member-card/layout"
import {
  isMemberCardImageUrlAllowed,
  memberCardPdfFilename,
  millimetresToPoints,
  sanitizeForWinAnsi,
  truncateToWidth,
} from "@/lib/pdf/member-card-pdf"

// The four pure pieces of the card PDF. Everything else in that module needs a PDF document,
// a network fetch or a native image decoder; these decide whether a card is the right physical
// size, whether a member's name survives being printed, whether a line is cut at the width it
// must not exceed, and whether the server is allowed to fetch a URL at all — so they are the
// parts worth pinning down.

describe("millimetresToPoints", () => {
  it("converts at 72 points per inch", () => {
    expect(millimetresToPoints(25.4)).toBe(72)
    expect(millimetresToPoints(0)).toBe(0)
  })

  it("keeps the card at its ISO ID-1 size", () => {
    // 85,6 × 53,98 mm — the numbers a ruler must find on the printed sheet.
    expect(millimetresToPoints(85.6)).toBeCloseTo(242.65, 2)
    expect(millimetresToPoints(53.98)).toBeCloseTo(153.01, 2)
  })

  it("is linear, so a length built from two constants measures the same either way", () => {
    expect(millimetresToPoints(4) + millimetresToPoints(20)).toBeCloseTo(millimetresToPoints(24), 10)
  })
})

describe("sanitizeForWinAnsi", () => {
  it("leaves Western European text untouched", () => {
    expect(sanitizeForWinAnsi("Éloïse Nguyên-Français")).toBe("Éloïse Nguyên-Français")
    // The typographic characters the French catalogue is full of live in CP1252's 0x80 block.
    expect(sanitizeForWinAnsi("Valable jusqu’au 31/12/2026 — 85,6 × 54 mm…")).toBe("Valable jusqu’au 31/12/2026 — 85,6 × 54 mm…")
  })

  it("strips combining accents WinAnsi has no glyph for", () => {
    expect(sanitizeForWinAnsi("Wiśniewski")).toBe("Wisniewski")
    expect(sanitizeForWinAnsi("Řehoř")).toBe("Rehor")
    expect(sanitizeForWinAnsi("Çağrı Şahin")).toBe("Çagri Sahin")
  })

  it("falls back to a base letter for the ones that carry no separable accent", () => {
    // Without the explicit table, "Łukasz" would lose its first letter entirely.
    expect(sanitizeForWinAnsi("Łukasz")).toBe("Lukasz")
    expect(sanitizeForWinAnsi("Đorđe")).toBe("Dorde")
  })

  it("never throws on a script Helvetica cannot write at all", () => {
    // Visibly wrong beats an exception: a member with a Cyrillic name still gets a card.
    expect(sanitizeForWinAnsi("Иванов")).toBe("??????")
    expect(sanitizeForWinAnsi("")).toBe("")
  })

  // The separator formatMemberCardContact joins with. U+00B7 is WinAnsi 0xB7, so the printed
  // card reads "01 23 45 67 89 · contact@…" and not "01 23 45 67 89 ? contact@…".
  it("keeps the middle dot the contact line is joined with", () => {
    expect(sanitizeForWinAnsi("01 23 45 67 89 · contact@amis-du-parc.fr"))
      .toBe("01 23 45 67 89 · contact@amis-du-parc.fr")
  })
})

describe("truncateToWidth", () => {
  const CONTACT_SIZE_PT      = millimetresToPoints(CARD_FONT_FOOTER_MM)
  const CONTACT_MAX_WIDTH_PT = millimetresToPoints(CARD_CONTACT_MAX_WIDTH_MM)

  // The same standard font the renderer draws with, so the widths measured here are the widths
  // that end up on paper.
  let helvetica: PDFFont
  beforeAll(async () => {
    helvetica = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica)
  })

  it("leaves a line that fits exactly as it is", () => {
    const contactLine = "01 23 45 67 89 · contact@amis-du-parc.fr"
    expect(truncateToWidth(helvetica, contactLine, CONTACT_SIZE_PT, CONTACT_MAX_WIDTH_PT)).toBe(contactLine)
  })

  // The cap is a measured width, not a character count: a long address is cut wherever 54,6 mm
  // of Helvetica runs out, which is what keeps the line clear of the QR column.
  it("cuts a line that would reach the QR, and marks the cut", () => {
    const tooLongContactLine = "01 23 45 67 89 · association-des-amis-du-parc-de-la-ville@exemple-tres-long.fr"
    const truncated = truncateToWidth(helvetica, tooLongContactLine, CONTACT_SIZE_PT, CONTACT_MAX_WIDTH_PT)

    expect(truncated).not.toBe(tooLongContactLine)
    expect(truncated.endsWith("…")).toBe(true)
    expect(tooLongContactLine.startsWith(truncated.slice(0, -1))).toBe(true)
    // Ellipsis included — the whole point is that nothing crosses the cap.
    expect(helvetica.widthOfTextAtSize(truncated, CONTACT_SIZE_PT)).toBeLessThanOrEqual(CONTACT_MAX_WIDTH_PT)
  })

  it("returns nothing at all when not even one character and its ellipsis fit", () => {
    expect(truncateToWidth(helvetica, "contact@amis-du-parc.fr", CONTACT_SIZE_PT, 1)).toBe("")
  })
})

describe("memberCardPdfFilename", () => {
  it("names the file last name first, in ASCII", () => {
    expect(memberCardPdfFilename("Martin", "Camille")).toBe("carte-membre-martin-camille.pdf")
    expect(memberCardPdfFilename("Nguyên-Français", "Éloïse")).toBe("carte-membre-nguyen-francais-eloise.pdf")
  })

  it("keeps the letters toSlug alone would drop", () => {
    expect(memberCardPdfFilename("Wiśniewski", "Łukasz")).toBe("carte-membre-wisniewski-lukasz.pdf")
  })

  it("never produces an empty or double-dashed name", () => {
    // A name that folds to nothing (Cyrillic, CJK) must not yield "carte-membre--.pdf".
    expect(memberCardPdfFilename("Иванов", "Дмитрий")).toBe("carte-membre.pdf")
    expect(memberCardPdfFilename("", "")).toBe("carte-membre.pdf")
    expect(memberCardPdfFilename("Martin", "")).toBe("carte-membre-martin.pdf")
  })

  it("leaves nothing a Content-Disposition header could be broken with", () => {
    expect(memberCardPdfFilename('Mar"tin', "Ca\nmille")).toBe("carte-membre-mar-tin-ca-mille.pdf")
  })
})

describe("isMemberCardImageUrlAllowed", () => {
  afterEach(() => vi.unstubAllEnvs())

  it("accepts our own R2 public host", () => {
    vi.stubEnv("R2_PUBLIC_URL", "https://files.formwise.fr")
    expect(isMemberCardImageUrlAllowed("https://files.formwise.fr/adhera/logo.png")).toBe(true)
    // The stored base may carry a path; only the origin is compared.
    vi.stubEnv("R2_PUBLIC_URL", "https://files.formwise.fr/bucket/")
    expect(isMemberCardImageUrlAllowed("https://files.formwise.fr/adhera/photo.jpg")).toBe(true)
  })

  it("refuses every other origin", () => {
    vi.stubEnv("R2_PUBLIC_URL", "https://files.formwise.fr")
    // A suffix match would let this one through — the whole point of comparing origins.
    expect(isMemberCardImageUrlAllowed("https://files.formwise.fr.evil.com/logo.png")).toBe(false)
    expect(isMemberCardImageUrlAllowed("http://files.formwise.fr/logo.png")).toBe(false)
    expect(isMemberCardImageUrlAllowed("https://evil.com/logo.png")).toBe(false)
    // The member's own photoUrl is a free-form string (PATCH /api/portal/profil): these are
    // exactly the values that would turn the PDF route into an SSRF primitive.
    expect(isMemberCardImageUrlAllowed("http://169.254.169.254/latest/meta-data/")).toBe(false)
    expect(isMemberCardImageUrlAllowed("file:///etc/passwd")).toBe(false)
    expect(isMemberCardImageUrlAllowed("not a url")).toBe(false)
  })

  it("refuses everything when no R2 host is configured", () => {
    vi.stubEnv("R2_PUBLIC_URL", "")
    expect(isMemberCardImageUrlAllowed("https://files.formwise.fr/logo.png")).toBe(false)
  })
})
