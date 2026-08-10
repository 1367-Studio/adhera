import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib"

export interface MeetingMinutesPdfInput {
  title:       string
  scheduledAt: Date | null
  startedAt:   Date | null
  endedAt:     Date | null
  association: {
    name: string
    // Resolved by resolveDocumentBranding() — already null when the association's plan
    // doesn't include custom branding, same convention as document-pdf.ts.
    logoUrl: string | null
  }
  participants: { firstName: string; lastName: string }[]
  summary:      string | null
  transcript:   string | null
}

const PAGE_WIDTH  = 595.28
const PAGE_HEIGHT = 841.89
const MARGIN      = 50
const GRAY  = rgb(0.45, 0.45, 0.45)
const BLACK = rgb(0.1, 0.1, 0.1)

function fmtDateTime(d: Date): string {
  return `${d.toLocaleDateString("fr-FR")} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
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

// Splits on existing newlines first — the transcript already has one line per speaker turn
// (see formatTranscript in transcribe/route.ts), and the AI summary has its own paragraph/
// bullet structure — so wrapping long lines never merges two separate source lines into one.
function wrapParagraph(paragraph: string, font: PDFFont, size: number, maxWidth: number): string[] {
  return paragraph.split("\n").flatMap(line => wrapText(line, font, size, maxWidth))
}

export async function buildMeetingMinutesPdf(input: MeetingMinutesPdfInput): Promise<Buffer> {
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
      logoImage = null // logo optional — never fail the ata over a broken image
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

  // Draws a block of already-wrapped lines, breaking to a new page mid-block if needed —
  // shared by the summary and transcript sections, since both can run long.
  function drawParagraphLines(lines: string[], size: number, lineHeight: number) {
    for (const line of lines) {
      if (y < MARGIN + lineHeight) newPage()
      text(line, MARGIN, size)
      y -= lineHeight
    }
  }

  // ── Header ──────────────────────────────────────────────────────────
  textRight("COMPTE-RENDU DE RÉUNION", PAGE_WIDTH - MARGIN, 14, { bold: true, color: ACCENT })
  if (logoImage) {
    const maxW = 180, maxH = 64
    const scale = Math.min(maxW / logoImage.width, maxH / logoImage.height, 1)
    const w = logoImage.width * scale
    const h = logoImage.height * scale
    page.drawImage(logoImage, { x: MARGIN, y: y - h + 2, width: w, height: h })
    y -= h + 10
  } else {
    text(input.association.name, MARGIN, 14, { bold: true })
    y -= 20
  }
  y -= 10
  page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1, color: ACCENT })
  y -= 24

  // ── Meeting title + date/time ────────────────────────────────────────
  for (const line of wrapText(input.title, bold, 16, PAGE_WIDTH - 2 * MARGIN)) {
    text(line, MARGIN, 16, { bold: true })
    y -= 20
  }
  y -= 4
  if (input.scheduledAt) {
    text(`Prévue le : ${fmtDateTime(input.scheduledAt)}`, MARGIN, 9, { color: GRAY })
    y -= 14
  }
  if (input.startedAt) {
    const range = input.endedAt
      ? `${fmtDateTime(input.startedAt)} — ${input.endedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`
      : fmtDateTime(input.startedAt)
    text(`Déroulée : ${range}`, MARGIN, 9, { color: GRAY })
    y -= 14
  }
  y -= 10

  // ── Participants ─────────────────────────────────────────────────────
  text("Participants", MARGIN, 9, { bold: true, color: ACCENT })
  y -= 14
  const names = input.participants.map(p => `${p.firstName} ${p.lastName}`).join(", ") || "Aucun participant enregistré."
  for (const line of wrapText(names, font, 9, PAGE_WIDTH - 2 * MARGIN)) {
    text(line, MARGIN, 9)
    y -= 13
  }
  y -= 14

  // ── Summary (AI), only if available ──────────────────────────────────
  if (input.summary?.trim()) {
    if (y < 100) newPage()
    text("Résumé", MARGIN, 9, { bold: true, color: ACCENT })
    y -= 14
    drawParagraphLines(wrapParagraph(input.summary, font, 9, PAGE_WIDTH - 2 * MARGIN), 9, 13)
    y -= 14
  }

  // ── Transcription ────────────────────────────────────────────────────
  if (y < 100) newPage()
  text("Transcription", MARGIN, 9, { bold: true, color: ACCENT })
  y -= 14
  const transcriptBody = input.transcript?.trim() || "Aucune transcription disponible."
  drawParagraphLines(wrapParagraph(transcriptBody, font, 8.5, PAGE_WIDTH - 2 * MARGIN), 8.5, 12)

  return Buffer.from(await doc.save())
}
