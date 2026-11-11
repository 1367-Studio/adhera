// src/lib/pdf/income-statement-pdf-client.ts
import { BASE_PATH } from "@/lib/env"
import { loadLogoForPdf } from "@/lib/pdf/branded-header-client"
import type { AssociationPlan } from "@prisma/client"

type AssociationBranding = {
  name: string
  plan: AssociationPlan
  customBrandingEnabled: boolean | null
  logoUrl: string | null
}

export interface IncomeStatementPdfRow {
  label:    string
  current:  number | null // null = section header (no amount)
  previous: number | null
  bold?:    boolean
}

// FORM-104: "Contributions volontaires en nature" — a standalone full-width block printed after
// the main table, mirroring InKindContributionsSection on screen. `employments` and `received`
// are matched by position (not by category identity) exactly like the screen component; the
// shorter list is padded with blank cells when the two sides have a different number of
// categories.
export interface IncomeStatementPdfInKind {
  title:                 string
  employmentHeader:      string
  receivedHeader:        string
  amountHeader:          string
  totalEmploymentsLabel: string
  totalReceivedLabel:    string
  note:                  string
  employments:      { label: string; amount: number }[]
  received:         { label: string; amount: number }[]
  totalEmployments: number
  totalReceived:    number
}

export interface IncomeStatementPdfParams {
  title:            string
  // Header for the row-label column (point 1 — "Catégorie", replacing the old blank cell).
  categoryLabel:    string
  currentLabel:     string
  previousLabel:    string
  // false when there's no N-1 exercice to compare against — drops the N-1 column entirely
  // instead of rendering it as a blank, bordered stripe down the whole page (every row's
  // `previous` is null in that case anyway, same as the screen already hides the column).
  hasPrevious:      boolean
  rows:             IncomeStatementPdfRow[]
  // null/omitted = no contributions to show for the selected exercice (same rule as the screen).
  inKind?:          IncomeStatementPdfInKind | null
  fileNameSuffix:   string
  // "Période du dd/MM/yyyy au dd/MM/yyyy" — the exercice's real fiscal period, shown under the
  // association name/title like the reference accountant document this export is modeled on.
  periodLabel?:     string
}

// jsPDF's built-in Helvetica font only covers WinAnsi — the narrow no-break space (U+202F)
// fr-FR uses as a thousands separator has no glyph there and silently renders as garbage
// (a slash). Swap it for a plain space, which does exist in the font, after formatting.
// `n === 0 ? 0 : n` strips negative zero (`-0`) before formatting — an empty expense
// section total is `-emptySum`, which in JS is `-0`, not `0`; left alone it renders as the
// confusing "-0,00 €" instead of "0,00 €" for a section with no expense activity.
const fmt = (n: number) => (n === 0 ? 0 : n).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }).replace(/[  ]/g, " ")

export async function exportIncomeStatementPdf(params: IncomeStatementPdfParams) {
  const assocRes = await fetch(`${BASE_PATH}/api/association`)
  const assoc: AssociationBranding | null = assocRes.ok ? await assocRes.json() : null

  const { default: jsPDF }     = await import("jspdf")
  const { default: autoTable } = await import("jspdf-autotable")

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" })
  const W = 210
  const M = 14
  const ZINC = [113, 113, 122] as [number, number, number]
  const today = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })

  const canBrand = assoc ? (assoc.customBrandingEnabled ?? assoc.plan === "PRO") : false
  const logo = canBrand && assoc?.logoUrl ? await loadLogoForPdf(`${BASE_PATH}/api/association/branding/logo`) : null

  let y = 20

  if (logo) {
    const logoH = 14
    const logoW = logo.width * (logoH / logo.height)
    doc.addImage(logo.dataUrl, logo.format, M, y - logoH + 4, logoW, logoH)
    y += 4
  }

  doc.setTextColor(24, 24, 27)
  doc.setFontSize(12)
  doc.setFont("helvetica", "bold")
  doc.text(assoc?.name ?? "Association", M, y + 12)

  doc.setFontSize(13)
  doc.setFont("helvetica", "bold")
  doc.text(params.title.toUpperCase(), W - M, y + 8, { align: "right" })

  y += 20
  doc.setDrawColor(24, 24, 27)
  doc.setLineWidth(0.5)
  doc.line(M, y, W - M, y)
  y += 7

  doc.setFontSize(8)
  doc.setFont("helvetica", "normal")
  doc.setTextColor(...ZINC)
  if (params.periodLabel) {
    doc.text(params.periodLabel, M, y)
    y += 5
  }
  doc.text(`Généré le ${today}`, M, y)
  y += 6

  const boldRowIndexes = new Set(params.rows.map((r, i) => (r.bold ? i : -1)).filter(i => i >= 0))

  autoTable(doc, {
    startY: y,
    margin: { left: M, right: M },
    head: params.hasPrevious
      ? [[params.categoryLabel, params.currentLabel, params.previousLabel]]
      : [[params.categoryLabel, params.currentLabel]],
    body: params.rows.map(r => params.hasPrevious
      ? [r.label, r.current === null ? "" : fmt(r.current), r.previous === null ? "" : fmt(r.previous)]
      : [r.label, r.current === null ? "" : fmt(r.current)]),
    columnStyles: params.hasPrevious ? { 1: { halign: "right" }, 2: { halign: "right" } } : { 1: { halign: "right" } },
    headStyles: { fillColor: [255, 255, 255], textColor: [24, 24, 27], fontStyle: "bold", fontSize: 9, lineColor: [24, 24, 27], lineWidth: { bottom: 0.4 } },
    bodyStyles: { fontSize: 9, textColor: [24, 24, 27] },
    styles:     { cellPadding: 2, lineColor: [228, 228, 231], lineWidth: 0.1 },
    didParseCell: (data) => {
      if (data.section === "body" && boldRowIndexes.has(data.row.index)) {
        data.cell.styles.fontStyle = "bold"
      }
    },
  })

  if (params.inKind) {
    const ik = params.inKind
    const rowCount = Math.max(ik.employments.length, ik.received.length)
    const body = Array.from({ length: rowCount }, (_, i) => [
      ik.employments[i]?.label ?? "", ik.employments[i] ? fmt(ik.employments[i].amount) : "",
      ik.received[i]?.label ?? "",    ik.received[i]    ? fmt(ik.received[i].amount)    : "",
    ])
    body.push([ik.totalEmploymentsLabel, fmt(ik.totalEmployments), ik.totalReceivedLabel, fmt(ik.totalReceived)])
    const totalRowIndex = body.length - 1

    let inKindY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10
    doc.setFontSize(10)
    doc.setFont("helvetica", "bold")
    doc.setTextColor(24, 24, 27)
    doc.text(ik.title, M, inKindY)
    inKindY += 4

    autoTable(doc, {
      startY: inKindY,
      margin: { left: M, right: M },
      head:   [[ik.employmentHeader, ik.amountHeader, ik.receivedHeader, ik.amountHeader]],
      body,
      columnStyles: { 1: { halign: "right" }, 3: { halign: "right" } },
      headStyles: { fillColor: [255, 255, 255], textColor: [24, 24, 27], fontStyle: "bold", fontSize: 9, lineColor: [24, 24, 27], lineWidth: { bottom: 0.4 } },
      bodyStyles: { fontSize: 9, textColor: [24, 24, 27] },
      styles:     { cellPadding: 2, lineColor: [228, 228, 231], lineWidth: 0.1 },
      didParseCell: (data) => {
        if (data.section === "body" && data.row.index === totalRowIndex) {
          data.cell.styles.fontStyle = "bold"
        }
      },
    })

    const noteY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5
    doc.setFontSize(8)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(...ZINC)
    doc.text(doc.splitTextToSize(ik.note, W - 2 * M), M, noteY)
  }

  const pageCount = doc.getNumberOfPages()
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p)
    doc.setFontSize(7)
    doc.setTextColor(...ZINC)
    doc.text(`Page ${p} / ${pageCount}`, W - M, 290, { align: "right" })
  }

  doc.save(`compte-de-resultat-${params.fileNameSuffix}.pdf`)
}
