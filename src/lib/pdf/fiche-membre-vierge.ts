import { PDFDocument, PDFPage, StandardFonts, rgb } from "pdf-lib"

// Day-month-year order holds across every EU locale this app ships (SUPPORTED_LOCALES) — it
// is not an English-vs-rest split like it would be for a US-targeted product — so a single
// digit pattern removes the format ambiguity for every language without needing translation.
const BIRTH_DATE_FORMAT_HINT = "DD/MM/YYYY"

export interface FicheMembreViergeLabels {
  title:    string
  subtitle: string
  sections: {
    personalInfo:   string
    address:        string
    memberInfo:     string
    legalGuardian:  string
    additionalInfo: string
  }
  fields: {
    firstName:       string
    lastName:        string
    email:            string
    phone:            string
    mobile:           string
    birthDate:        string
    civilite:         string
    sexe:             string
    addressStreet:    string
    addressComplement: string
    postalCode:       string
    city:             string
    country:          string
    spokenLanguage:   string
    preferredLocale:  string
    type:             string
    guardianName1:    string
    guardianPhone1:   string
    guardianName2:    string
    guardianPhone2:   string
    imageRights:      string
  }
  // [Mme, Mlle, M.] / [Homme, Femme] / [Oui, Non] — translated, order-fixed tuples rather than
  // a map, since every caller (route.ts) and the renderer agree on what each slot means.
  civiliteOptions:    [string, string, string]
  sexeOptions:        [string, string]
  imageRightsOptions: [string, string]
  signature: string
  date:      string
}

export interface FicheMembreViergeInput {
  association: {
    name: string
    // Resolved by resolveDocumentBranding() — already null when the association's plan
    // doesn't include custom branding, see src/lib/pdf/document-pdf.ts for the same pattern.
    logoUrl: string | null
  }
  labels: FicheMembreViergeLabels
  // false when the requesting manager lacks `sensible:read` — the same permission that hides
  // guardianName/guardianPhone on the "Ajouter manuellement" screen (security audit M2+L8).
  // The blank sheet carries no real data either way, but the field *labels* already disclose
  // that this association collects guardian contact details, which is exactly what that gate
  // exists to keep from a manager who shouldn't even know to ask for it.
  includeGuardianFields: boolean
  // Null when the association requires no document (requiredDocuments() returned empty) — the
  // whole section is omitted rather than printed with nothing under it. `intro` is already the
  // resolved legalConsent.agreeLabel string (route.ts resolves its ICU plural, since that
  // needs next-intl's request context); `documentTitles` are the association's own documents,
  // in whatever language it wrote them — never translated.
  legalConsent: { intro: string; documentTitles: string[] } | null
}

const PAGE_WIDTH  = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN      = 50
const CONTENT_W   = PAGE_WIDTH - 2 * MARGIN
const GRAY      = rgb(0.45, 0.45, 0.45)
const LINE_GRAY = rgb(0.7, 0.7, 0.7)
const BLACK     = rgb(0.1, 0.1, 0.1)

export async function buildFicheMembreViergePdf(input: FicheMembreViergeInput): Promise<Buffer> {
  const { labels } = input
  const doc  = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const ACCENT = GRAY

  let logoImage: Awaited<ReturnType<PDFDocument["embedPng"]>> | null = null
  if (input.association.logoUrl) {
    try {
      const res = await fetch(input.association.logoUrl)
      const bytes = new Uint8Array(await res.arrayBuffer())
      const contentType = res.headers.get("content-type") ?? ""
      logoImage = contentType.includes("png") ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
    } catch {
      logoImage = null // logo optional — never fail the export over a broken image
    }
  }

  const page: PDFPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  let y = PAGE_HEIGHT - MARGIN

  function text(str: string, x: number, atY: number, size = 10, opts: { bold?: boolean; color?: ReturnType<typeof rgb> } = {}) {
    page.drawText(str, { x, y: atY, size, font: opts.bold ? bold : font, color: opts.color ?? BLACK })
  }

  // Shrinks the font until `str` fits `maxWidth`, down to a floor where truncating with an
  // ellipsis takes over — a long association name must never run into the title or off the
  // page edge, whatever a manager typed when they set it up.
  function fitText(str: string, maxWidth: number, size: number, f: typeof font): { str: string; size: number } {
    const MIN_SIZE = 9
    let s = size
    while (s > MIN_SIZE && f.widthOfTextAtSize(str, s) > maxWidth) s -= 0.5
    if (f.widthOfTextAtSize(str, s) <= maxWidth) return { str, size: s }
    let truncated = str
    while (truncated.length > 1 && f.widthOfTextAtSize(truncated + "…", s) > maxWidth) {
      truncated = truncated.slice(0, -1)
    }
    return { str: truncated + "…", size: s }
  }

  function textRight(str: string, rightX: number, atY: number, size = 10, opts: { bold?: boolean; color?: ReturnType<typeof rgb> } = {}) {
    const f = opts.bold ? bold : font
    text(str, rightX - f.widthOfTextAtSize(str, size), atY, size, opts)
  }

  // Draws a label above a blank underline, meant to be filled in by hand. Consumes no
  // vertical space itself — the caller decrements `y` afterwards for the next row. `hint`
  // (e.g. a date format) prints right-aligned on the same line as the label, same muted
  // treatment, so it reads as guidance rather than a second field.
  function line(label: string, x: number, width: number, atY: number, hint?: string) {
    page.drawText(label, { x, y: atY + 4, size: 9, font, color: GRAY })
    if (hint) {
      const hintSize = 8
      page.drawText(hint, { x: x + width - font.widthOfTextAtSize(hint, hintSize), y: atY + 4, size: hintSize, font, color: LINE_GRAY })
    }
    page.drawLine({ start: { x, y: atY - 12 }, end: { x: x + width, y: atY - 12 }, thickness: 0.75, color: LINE_GRAY })
  }

  // Draws a label followed by inline checkboxes (☐ Option), for single-choice fields
  // filled by hand (Sexe, Civilité, Droit à l'image).
  function checkboxGroup(label: string, options: string[], x: number, atY: number) {
    page.drawText(label, { x, y: atY + 4, size: 9, font, color: GRAY })
    const boxSize = 9
    let cx = x
    const boxY = atY - 12
    for (const opt of options) {
      page.drawRectangle({ x: cx, y: boxY, width: boxSize, height: boxSize, borderColor: LINE_GRAY, borderWidth: 1 })
      page.drawText(opt, { x: cx + boxSize + 4, y: boxY + 1, size: 10, font, color: BLACK })
      cx += boxSize + 4 + font.widthOfTextAtSize(opt, 10) + 14
    }
  }

  // Bold section label matching the "Ajouter manuellement" form's own fieldset legends —
  // keeps the printed sheet legible as the same field groups without boxing them off.
  function sectionHeader(label: string, atY: number) {
    page.drawText(label, { x: MARGIN, y: atY, size: 11, font: bold, color: ACCENT })
  }

  // Greedy word-wrap against a max width, for the one piece of this sheet that is genuinely
  // free-length text (a document title an association admin typed themselves — unlike every
  // translated label here, its length is unbounded).
  function wrapLines(str: string, maxWidth: number, size: number): string[] {
    const words = str.split(" ")
    const lines: string[] = []
    let current = ""
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word
      if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
        lines.push(current)
        current = word
      } else {
        current = candidate
      }
    }
    if (current) lines.push(current)
    return lines
  }

  // ── Header ─────────────────────────────────────────────────────────────
  // The title is drawn top-right first, but the vertical gap below it is reserved
  // unconditionally — logo or not — before the association name is drawn. Previously the
  // name was drawn at the *same* y as the title whenever there was no logo, so a long
  // association name (common — this is admin-entered free text) could run into "FICHE
  // MEMBRE" instead of just sitting below it.
  textRight(labels.title, PAGE_WIDTH - MARGIN, y, 16, { bold: true, color: ACCENT })
  y -= 28

  if (logoImage) {
    const maxW = 180, maxH = 64
    const scale = Math.min(maxW / logoImage.width, maxH / logoImage.height, 1)
    const w = logoImage.width * scale
    const h = logoImage.height * scale
    page.drawImage(logoImage, { x: MARGIN, y: y - h + 2, width: w, height: h })
    y -= h + 18
  }
  // Always printed — a logo is often just a symbol/icon, not a substitute for the
  // association's actual name, so it shouldn't replace the name when present (same
  // reasoning as buildDocumentPdf in document-pdf.ts). Width-fit against the title's own
  // reserved margin so an unusually long name shrinks or truncates instead of overflowing.
  const fittedName = fitText(input.association.name, CONTENT_W, 14, bold)
  text(fittedName.str, MARGIN, y, fittedName.size, { bold: true })
  y -= 20
  y -= 6
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1, color: ACCENT })
  y -= 16
  text(labels.subtitle, MARGIN, y, 9, { color: GRAY })
  y -= 32

  // ── Fields ───────────────────────────────────────────────────────────────
  // Same fields, labels and order as the "Ajouter manuellement" form (membre-form.tsx) in
  // create mode — see FORM-109. Scoped to what the new member themselves can actually fill
  // in by hand: this sheet is explicitly "à compléter par le nouveau membre" (see header
  // above), so the form's admin-only controls (Rôle, Tarif de cotisation, Statut, Notes,
  // attestation légale, and the Responsable légal dropdown of existing Formwise members) are
  // left off — a new member has no way to fill those in on paper. The two free-text guardian
  // fields (nom/téléphone) are kept when includeGuardianFields allows it, since those are
  // exactly what gets handwritten here.
  const halfW  = (CONTENT_W - 20) / 2
  const rightX = MARGIN + halfW + 20
  const thirdGap = 16
  const thirdW = (CONTENT_W - 2 * thirdGap) / 3
  const col2X = MARGIN + thirdW + thirdGap
  const col3X = MARGIN + 2 * (thirdW + thirdGap)

  sectionHeader(labels.sections.personalInfo, y)
  y -= 20

  line(labels.fields.firstName, MARGIN, halfW, y)
  line(labels.fields.lastName, rightX, halfW, y)
  y -= 40

  line(labels.fields.email, MARGIN, thirdW, y)
  line(labels.fields.phone, col2X, thirdW, y)
  line(labels.fields.mobile, col3X, thirdW, y)
  y -= 40

  line(labels.fields.birthDate, MARGIN, thirdW, y, BIRTH_DATE_FORMAT_HINT)
  checkboxGroup(labels.fields.civilite, labels.civiliteOptions, col2X, y)
  checkboxGroup(labels.fields.sexe, labels.sexeOptions, col3X, y)
  y -= 36

  sectionHeader(labels.sections.address, y)
  y -= 20

  line(labels.fields.addressStreet, MARGIN, CONTENT_W, y)
  y -= 40

  line(labels.fields.addressComplement, MARGIN, thirdW, y)
  line(labels.fields.postalCode, col2X, thirdW, y)
  line(labels.fields.city, col3X, thirdW, y)
  y -= 40

  line(labels.fields.country, MARGIN, CONTENT_W, y)
  y -= 40

  sectionHeader(labels.sections.memberInfo, y)
  y -= 20

  line(labels.fields.spokenLanguage, MARGIN, halfW, y)
  line(labels.fields.preferredLocale, rightX, halfW, y)
  y -= 40

  line(labels.fields.type, MARGIN, CONTENT_W, y)
  y -= 40

  if (input.includeGuardianFields) {
    sectionHeader(labels.sections.legalGuardian, y)
    y -= 20

    line(labels.fields.guardianName1, MARGIN, halfW, y)
    line(labels.fields.guardianPhone1, rightX, halfW, y)
    y -= 40

    line(labels.fields.guardianName2, MARGIN, halfW, y)
    line(labels.fields.guardianPhone2, rightX, halfW, y)
    y -= 40
  }

  sectionHeader(labels.sections.additionalInfo, y)
  y -= 20

  checkboxGroup(labels.fields.imageRights, labels.imageRightsOptions, MARGIN, y)
  y -= 34

  // ── Legal consent (only when the association actually requires agreement to something) ──
  // The on-screen "Ajouter manuellement" form instead shows the gestionnaire a checkbox
  // attesting *they* collected the member's agreement (legalOfflineAttestation) — meaningless
  // on paper, since there is no later step where that attestation gets recorded against
  // anything the member signed. This prints what the gestionnaire actually needs instead: the
  // document list, a real checkbox, and a signature/date line taken at intake.
  if (input.legalConsent) {
    const { intro, documentTitles } = input.legalConsent
    const boxSize = 9

    page.drawRectangle({ x: MARGIN, y: y - boxSize, width: boxSize, height: boxSize, borderColor: LINE_GRAY, borderWidth: 1 })
    text(intro, MARGIN + boxSize + 6, y - boxSize + 1, 9, { color: BLACK })
    y -= boxSize + 16

    const bulletIndent = MARGIN + 14
    const bulletWidth  = CONTENT_W - 14
    for (const title of documentTitles) {
      for (const wrapped of wrapLines(`•  ${title}`, bulletWidth, 9)) {
        text(wrapped, bulletIndent, y, 9, { color: GRAY })
        y -= 14
      }
    }
    y -= 18

    line(labels.signature, MARGIN, halfW, y)
    line(labels.date, rightX, halfW, y)
    y -= 40
  }

  return Buffer.from(await doc.save())
}
