import { PDFDocument, PDFPage, StandardFonts, rgb } from "pdf-lib"

export interface FicheMembreViergeInput {
  association: {
    name: string
    // Resolved by resolveDocumentBranding() — already null when the association's plan
    // doesn't include custom branding, see src/lib/pdf/document-pdf.ts for the same pattern.
    logoUrl:      string | null
    primaryColor: string | null
  }
}

const PAGE_WIDTH  = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN      = 50
const CONTENT_W   = PAGE_WIDTH - 2 * MARGIN
const GRAY      = rgb(0.45, 0.45, 0.45)
const LINE_GRAY = rgb(0.7, 0.7, 0.7)
const BLACK     = rgb(0.1, 0.1, 0.1)

function hexToRgb(hex: string): ReturnType<typeof rgb> | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return null
  const n = parseInt(m[1], 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

export async function buildFicheMembreViergePdf(input: FicheMembreViergeInput): Promise<Buffer> {
  const doc  = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const ACCENT = (input.association.primaryColor && hexToRgb(input.association.primaryColor)) || GRAY

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

  function text(str: string, x: number, size = 10, opts: { bold?: boolean; color?: ReturnType<typeof rgb> } = {}) {
    page.drawText(str, { x, y, size, font: opts.bold ? bold : font, color: opts.color ?? BLACK })
  }

  function textRight(str: string, rightX: number, size = 10, opts: { bold?: boolean; color?: ReturnType<typeof rgb> } = {}) {
    const f = opts.bold ? bold : font
    text(str, rightX - f.widthOfTextAtSize(str, size), size, opts)
  }

  // Draws a label above a blank underline, meant to be filled in by hand. Consumes no
  // vertical space itself — the caller decrements `y` afterwards for the next row.
  function line(label: string, x: number, width: number, atY: number) {
    page.drawText(label, { x, y: atY + 4, size: 8, font, color: GRAY })
    page.drawLine({ start: { x, y: atY - 12 }, end: { x: x + width, y: atY - 12 }, thickness: 0.75, color: LINE_GRAY })
  }

  // Draws a label followed by inline checkboxes (☐ Option), for single-choice fields
  // filled by hand (Sexe, Civilité, Groupe sanguin).
  function checkboxGroup(label: string, options: string[], x: number, atY: number) {
    page.drawText(label, { x, y: atY + 4, size: 8, font, color: GRAY })
    const boxSize = 9
    let cx = x
    const boxY = atY - 12
    for (const opt of options) {
      page.drawRectangle({ x: cx, y: boxY, width: boxSize, height: boxSize, borderColor: LINE_GRAY, borderWidth: 1 })
      page.drawText(opt, { x: cx + boxSize + 4, y: boxY + 1, size: 9, font, color: BLACK })
      cx += boxSize + 4 + font.widthOfTextAtSize(opt, 9) + 14
    }
  }

  // ── Header ─────────────────────────────────────────────────────────────
  const titleStr = "FICHE MEMBRE"
  textRight(titleStr, PAGE_WIDTH - MARGIN, 16, { bold: true, color: ACCENT })
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
  // reasoning as buildDocumentPdf in document-pdf.ts).
  text(input.association.name, MARGIN, 14, { bold: true })
  y -= 20
  y -= 6
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1, color: ACCENT })
  y -= 16
  text("Fiche à compléter par le nouveau membre", MARGIN, 9, { color: GRAY })
  y -= 32

  // ── Fields ───────────────────────────────────────────────────────────────
  const halfW = (CONTENT_W - 20) / 2
  const rightX = MARGIN + halfW + 20

  line("Prénom", MARGIN, halfW, y)
  line("Nom", rightX, halfW, y)
  y -= 40

  line("Email", MARGIN, CONTENT_W, y)
  y -= 40

  line("Téléphone", MARGIN, halfW, y)
  line("Date de naissance", rightX, halfW, y)
  y -= 40

  checkboxGroup("Sexe", ["Homme", "Femme"], MARGIN, y)
  checkboxGroup("Civilité", ["Mme", "Mlle", "M."], rightX, y)
  y -= 34

  checkboxGroup("Groupe sanguin", ["A+", "A-", "B+", "B-"], MARGIN, y)
  checkboxGroup("", ["AB+", "AB-", "O+", "O-"], rightX, y)
  y -= 34

  checkboxGroup("Possède un tee-shirt", ["Oui", "Non"], MARGIN, y)
  y -= 34

  checkboxGroup("Taille du tee-shirt", ["XS", "S", "M", "L"], MARGIN, y)
  checkboxGroup("", ["XL", "XXL", "XXXL"], rightX, y)
  y -= 34

  line("Nom du responsable légal (si mineur)", MARGIN, CONTENT_W, y)
  y -= 40

  text("Allergies connues", MARGIN, 8, { color: GRAY })
  y -= 12
  for (let i = 0; i < 2; i++) {
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.75, color: LINE_GRAY })
    y -= 18
  }
  y -= 6

  text("Adresse", MARGIN, 8, { color: GRAY })
  y -= 12
  for (let i = 0; i < 2; i++) {
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.75, color: LINE_GRAY })
    y -= 18
  }
  y -= 6

  line("Type de membre", MARGIN, CONTENT_W, y)

  return Buffer.from(await doc.save())
}
