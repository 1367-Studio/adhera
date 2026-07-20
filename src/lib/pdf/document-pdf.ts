import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib"

export interface DocumentPdfItem {
  description: string
  quantity:    number
  unitPrice:   number
  vatRate:     number
  discount:    number
}

export interface DocumentPdfInput {
  kind:           "DEVIS" | "FACTURE" | "BOUTIQUE" | "MATERIEL_LOAN"
  number:         string
  issueDate:      Date
  secondaryLabel: string
  secondaryDate:  Date | null
  association: {
    name:    string
    address: string | null
    city:    string | null
    siren:   string | null
    website: string | null
    // Only ever printed on DEVIS/FACTURE (see buildDocumentPdf) — a BOUTIQUE receipt is
    // always for an already-settled sale, so a RIB has nothing useful to tell the buyer.
    iban: string | null
    bic:  string | null
    // Resolved by resolveDocumentBranding() — already null when the association's plan
    // doesn't include custom branding, so this file doesn't need to know about plans.
    logoUrl:      string | null
    primaryColor: string | null
  }
  fournisseur: {
    companyName: string
    address:     string | null
    city:        string | null
    postalCode:  string | null
    siret:       string | null
    vatNumber:   string | null
  } | null
  items:          DocumentPdfItem[]
  subtotal:       number
  vatAmount:      number
  discountAmount: number
  total:          number
  amountPaid?:    number
  notes:          string | null
  paymentTerms:   string | null
}

const PAGE_WIDTH  = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN      = 50
const GRAY  = rgb(0.45, 0.45, 0.45)
const BLACK = rgb(0.1, 0.1, 0.1)

const COL = { desc: MARGIN, qty: 300, price: 375, vat: 425, discount: 480, total: PAGE_WIDTH - MARGIN }

function hexToRgb(hex: string): ReturnType<typeof rgb> | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return null
  const n = parseInt(m[1], 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

// toLocaleString("fr-FR") inserts a narrow no-break space between thousands that the
// standard Helvetica (WinAnsi) encoding can't render — same issue already worked around
// in recu-fiscal.ts. Format manually with a plain space instead.
function fmtEUR(n: number): string {
  const sign = n < 0 ? "-" : ""
  const [intPart, decPart] = Math.abs(n).toFixed(2).split(".")
  const withThousands = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, " ")
  return `${sign}${withThousands},${decPart} €`
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("fr-FR")
}

// The "Adresse" field is free text, so it sometimes already ends with the city (typed
// that way, or picked from an autocomplete) while "Ville" is also filled in separately —
// without this, the two get concatenated and the city shows up twice on the document.
function stripTrailingCity(address: string | null, city: string | null): string | null {
  if (!address || !city) return address
  const trimmedAddress = address.trim()
  const trimmedCity    = city.trim()
  if (trimmedAddress.toLowerCase().endsWith(trimmedCity.toLowerCase())) {
    const withoutCity = trimmedAddress.slice(0, trimmedAddress.length - trimmedCity.length).replace(/[,\s]+$/, "")
    return withoutCity || null
  }
  return address
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
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
  return lines.length > 0 ? lines : [""]
}

export async function buildDocumentPdf(input: DocumentPdfInput): Promise<Buffer> {
  const doc     = await PDFDocument.create()
  const font    = await doc.embedFont(StandardFonts.Helvetica)
  const bold    = await doc.embedFont(StandardFonts.HelveticaBold)

  // Falls back to the platform's neutral gray whenever the association has no custom
  // color (or isn't entitled to one) — input.association.primaryColor is already null in
  // that case, see resolveDocumentBranding().
  const ACCENT = (input.association.primaryColor && hexToRgb(input.association.primaryColor)) || GRAY

  let logoImage: Awaited<ReturnType<PDFDocument["embedPng"]>> | null = null
  if (input.association.logoUrl) {
    try {
      const res = await fetch(input.association.logoUrl)
      const bytes = new Uint8Array(await res.arrayBuffer())
      const contentType = res.headers.get("content-type") ?? ""
      logoImage = contentType.includes("png")
        ? await doc.embedPng(bytes)
        : await doc.embedJpg(bytes)
    } catch {
      logoImage = null // logo optional — never fail a devis/facture over a broken image
    }
  }

  let page: PDFPage = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  let y = PAGE_HEIGHT - MARGIN

  function newPage() {
    page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    y = PAGE_HEIGHT - MARGIN
  }

  function text(str: string, x: number, size = 10, opts: { bold?: boolean; color?: ReturnType<typeof rgb> } = {}) {
    page.drawText(str, { x, y, size, font: opts.bold ? bold : font, color: opts.color ?? BLACK })
  }

  function textRight(str: string, rightX: number, size = 10, opts: { bold?: boolean; color?: ReturnType<typeof rgb> } = {}) {
    const f = opts.bold ? bold : font
    text(str, rightX - f.widthOfTextAtSize(str, size), size, opts)
  }

  const title = input.kind === "DEVIS" ? "DEVIS"
    : input.kind === "FACTURE"       ? "FACTURE"
    : input.kind === "MATERIEL_LOAN" ? "BON DE PRÊT"
    : "REÇU"

  // ── En-tête ──────────────────────────────────────────────────────────
  // Restrained on purpose — the accent color shows through the title, the rule below
  // and the totals further down, not through a full-bleed banner (reads as a marketing
  // flyer, not a financial document, on something this formal).
  const titleStr = `${title} N° ${input.number}`
  textRight(titleStr, COL.total, 16, { bold: true, color: ACCENT })
  if (logoImage) {
    const maxW = 180, maxH = 64
    const scale = Math.min(maxW / logoImage.width, maxH / logoImage.height, 1)
    const w = logoImage.width * scale
    const h = logoImage.height * scale
    page.drawImage(logoImage, { x: MARGIN, y: y - h + 2, width: w, height: h })
    y -= h + 10
  }
  // Without a logo, the name shares the title's line (top-left vs. top-right) — cap its
  // width so a long association name can't run into the title text instead of just
  // overlapping the empty page like a normal wrapped line would.
  const nameMaxWidth = logoImage
    ? COL.total - MARGIN
    : COL.total - MARGIN - bold.widthOfTextAtSize(titleStr, 16) - 20
  const nameLines = wrapText(input.association.name, bold, 14, Math.max(nameMaxWidth, 100))
  for (const line of nameLines) { text(line, MARGIN, 14, { bold: true }); y -= 16 }
  y -= 4
  if (input.association.address || input.association.city) {
    const associationAddress = stripTrailingCity(input.association.address, input.association.city)
    text([associationAddress, input.association.city].filter(Boolean).join(", "), MARGIN, 9, { color: GRAY })
    y -= 14
  }
  if (input.association.siren) {
    text(`SIREN : ${input.association.siren}`, MARGIN, 9, { color: GRAY })
    y -= 14
  }
  if (input.association.website) {
    // wrapText, not a single text() call — a long custom domain otherwise runs off the
    // right edge of the page instead of dropping to a second line like the name above it.
    for (const line of wrapText(input.association.website, font, 9, COL.total - MARGIN)) {
      text(line, MARGIN, 9, { color: GRAY })
      y -= 14
    }
  }
  y -= 6
  page.drawLine({ start: { x: MARGIN, y }, end: { x: COL.total, y }, thickness: 1, color: ACCENT })

  y -= 16
  text(`Date d'émission : ${fmtDate(input.issueDate)}`, MARGIN, 10)
  if (input.secondaryDate) {
    textRight(`${input.secondaryLabel} : ${fmtDate(input.secondaryDate)}`, COL.total, 10)
  }
  y -= 24

  // ── Destinataire ─────────────────────────────────────────────────────
  text("Destinataire", MARGIN, 9, { bold: true, color: ACCENT })
  y -= 14
  if (input.fournisseur) {
    text(input.fournisseur.companyName, MARGIN, 10, { bold: true })
    y -= 13
    const fournisseurAddress = stripTrailingCity(input.fournisseur.address, input.fournisseur.city)
    const addrLine = [fournisseurAddress, [input.fournisseur.postalCode, input.fournisseur.city].filter(Boolean).join(" ")].filter(Boolean).join(", ")
    if (addrLine) { text(addrLine, MARGIN, 9, { color: GRAY }); y -= 13 }
    if (input.fournisseur.siret)     { text(`SIRET : ${input.fournisseur.siret}`, MARGIN, 9, { color: GRAY }); y -= 13 }
    if (input.fournisseur.vatNumber) { text(`N° TVA : ${input.fournisseur.vatNumber}`, MARGIN, 9, { color: GRAY }); y -= 13 }
  } else {
    text("Client ponctuel", MARGIN, 10)
    y -= 13
  }
  y -= 16

  // ── Tableau des articles ─────────────────────────────────────────────
  function drawTableHeader() {
    text("Description", COL.desc, 9, { bold: true, color: ACCENT })
    textRight("Qté", COL.qty, 9, { bold: true, color: ACCENT })
    textRight("Prix U.", COL.price, 9, { bold: true, color: ACCENT })
    textRight("TVA %", COL.vat, 9, { bold: true, color: ACCENT })
    textRight("Remise", COL.discount, 9, { bold: true, color: ACCENT })
    textRight("Total", COL.total, 9, { bold: true, color: ACCENT })
    y -= 8
    page.drawLine({ start: { x: MARGIN, y }, end: { x: COL.total, y }, thickness: 0.5, color: ACCENT })
    y -= 14
  }
  drawTableHeader()

  for (const item of input.items) {
    const lineTotal  = item.quantity * item.unitPrice - item.discount
    const descLines  = wrapText(item.description, font, 9, COL.qty - COL.desc - 10)

    if (y - descLines.length * 12 < 140) { newPage(); drawTableHeader() }

    const rowTopY = y
    for (const line of descLines) { text(line, COL.desc, 9); y -= 12 }
    const afterDescY = y

    y = rowTopY
    textRight(String(item.quantity), COL.qty, 9)
    textRight(fmtEUR(item.unitPrice), COL.price, 9)
    textRight(`${item.vatRate}%`, COL.vat, 9)
    textRight(item.discount > 0 ? `- ${fmtEUR(item.discount)}` : "—", COL.discount, 9)
    textRight(fmtEUR(lineTotal), COL.total, 9)

    y = afterDescY - 6
  }

  y -= 4
  page.drawLine({ start: { x: MARGIN, y }, end: { x: COL.total, y }, thickness: 0.5, color: ACCENT })
  y -= 20

  // ── Totaux ───────────────────────────────────────────────────────────
  if (y < 160) newPage()
  const totalsLabelX = COL.total - 150
  text("Sous-total", totalsLabelX, 10, { color: GRAY }); textRight(fmtEUR(input.subtotal), COL.total, 10); y -= 15
  text("TVA", totalsLabelX, 10, { color: GRAY }); textRight(fmtEUR(input.vatAmount), COL.total, 10); y -= 15
  if (input.discountAmount > 0) {
    text("Remise totale", totalsLabelX, 10, { color: GRAY }); textRight(`- ${fmtEUR(input.discountAmount)}`, COL.total, 10); y -= 15
  }
  y -= 4
  page.drawLine({ start: { x: totalsLabelX, y }, end: { x: COL.total, y }, thickness: 0.5, color: ACCENT })
  y -= 16
  text("Total", totalsLabelX, 12, { bold: true, color: ACCENT }); textRight(fmtEUR(input.total), COL.total, 12, { bold: true, color: ACCENT }); y -= 18
  if (input.amountPaid !== undefined) {
    text("Payé", totalsLabelX, 10, { color: GRAY }); textRight(fmtEUR(input.amountPaid), COL.total, 10); y -= 15
    text("Restant dû", totalsLabelX, 10, { bold: true }); textRight(fmtEUR(input.total - input.amountPaid), COL.total, 10, { bold: true }); y -= 15
  }
  y -= 20

  // ── Coordonnées bancaires ────────────────────────────────────────────
  // FACTURE only: a BOUTIQUE receipt is for an already-settled sale (nothing left to pay),
  // and a DEVIS is just an estimate the client hasn't accepted yet — printing a RIB on it
  // reads as asking for payment before there's anything to actually pay.
  if (input.kind === "FACTURE" && (input.association.iban || input.association.bic)) {
    if (y < 100) newPage()
    text("Coordonnées bancaires", MARGIN, 9, { bold: true, color: GRAY }); y -= 13
    if (input.association.iban) { text(`IBAN : ${input.association.iban}`, MARGIN, 9); y -= 12 }
    if (input.association.bic)  { text(`BIC : ${input.association.bic}`, MARGIN, 9); y -= 12 }
    y -= 10
  }

  // ── Conditions / notes ─────────────────────────────────────────────
  if (input.paymentTerms) {
    if (y < 100) newPage()
    text("Conditions de paiement", MARGIN, 9, { bold: true, color: GRAY }); y -= 13
    for (const line of wrapText(input.paymentTerms, font, 9, PAGE_WIDTH - 2 * MARGIN)) { text(line, MARGIN, 9); y -= 12 }
    y -= 10
  }
  if (input.notes) {
    if (y < 100) newPage()
    text("Notes", MARGIN, 9, { bold: true, color: GRAY }); y -= 13
    for (const line of wrapText(input.notes, font, 9, PAGE_WIDTH - 2 * MARGIN)) { text(line, MARGIN, 9); y -= 12 }
  }

  return Buffer.from(await doc.save())
}
