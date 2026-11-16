// src/lib/pdf/bilan-pdf-client.ts
// Modeled on budget-pdf-client.ts/income-statement-pdf-client.ts (same jsPDF + jspdf-autotable,
// client-side-only, branded-header approach) — see FORM-107. Two sequential tables (Actif then
// Passif) on the same page, the same way income-statement-pdf-client.ts prints its main table
// then the "Contributions volontaires en nature" block below it via `lastAutoTable.finalY`.
import { BASE_PATH } from "@/lib/env"
import { loadLogoForPdf } from "@/lib/pdf/branded-header-client"
import type { AssociationPlan } from "@prisma/client"

type AssociationBranding = {
  name: string
  plan: AssociationPlan
  customBrandingEnabled: boolean | null
  logoUrl: string | null
}

export interface BilanPdfRow {
  label:    string
  current:  number | null // null = section header / spacer row (no amount)
  previous: number | null
  bold?:    boolean
}

export interface BilanPdfParams {
  title:          string
  rubriqueLabel:  string // "Rubrique" column header
  currentLabel:   string
  previousLabel:  string
  actifTitle:     string
  passifTitle:    string
  actifRows:      BilanPdfRow[]
  passifRows:     BilanPdfRow[]
  periodLabel?:   string
  fileNameSuffix: string
}

// Same WinAnsi narrow-no-break-space fix and "-0 € becomes 0 €" fix as the other *-pdf-client
// modules — see income-statement-pdf-client.ts's doc comment on `fmt`.
const fmt = (n: number) => (n === 0 ? 0 : n).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }).replace(/[  ]/g, " ")

function bilanTable(doc: InstanceType<typeof import("jspdf").default>, autoTable: typeof import("jspdf-autotable").default, startY: number, title: string, rows: BilanPdfRow[], params: BilanPdfParams, M: number): number {
  doc.setFontSize(10)
  doc.setFont("helvetica", "bold")
  doc.setTextColor(24, 24, 27)
  doc.text(title, M, startY)

  const boldRowIndexes = new Set(rows.map((r, i) => (r.bold ? i : -1)).filter(i => i >= 0))

  autoTable(doc, {
    startY: startY + 4,
    margin: { left: M, right: M },
    head:   [[params.rubriqueLabel, params.currentLabel, params.previousLabel]],
    body:   rows.map(r => [r.label, r.current === null ? "" : fmt(r.current), r.previous === null ? "" : fmt(r.previous)]),
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" } },
    headStyles: { fillColor: [255, 255, 255], textColor: [24, 24, 27], fontStyle: "bold", fontSize: 9, lineColor: [24, 24, 27], lineWidth: { bottom: 0.4 } },
    bodyStyles: { fontSize: 9, textColor: [24, 24, 27] },
    styles:     { cellPadding: 2, lineColor: [228, 228, 231], lineWidth: 0.1 },
    didParseCell: (data) => {
      if (data.section === "body" && boldRowIndexes.has(data.row.index)) {
        data.cell.styles.fontStyle = "bold"
      }
    },
  })

  return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY
}

export async function exportBilanPdf(params: BilanPdfParams) {
  const assocRes = await fetch(`${BASE_PATH}/api/association`)
  const assoc: AssociationBranding | null = assocRes.ok ? await assocRes.json() : null

  const { default: jsPDF }     = await import("jspdf")
  const { default: autoTable } = await import("jspdf-autotable")

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" })
  const W = 210
  const M = 14
  const ZINC: [number, number, number] = [113, 113, 122]
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
  y += 8

  const afterActif = bilanTable(doc, autoTable, y, params.actifTitle, params.actifRows, params, M)
  bilanTable(doc, autoTable, afterActif + 10, params.passifTitle, params.passifRows, params, M)

  const pageCount = doc.getNumberOfPages()
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p)
    doc.setFontSize(7)
    doc.setTextColor(...ZINC)
    doc.text(`Page ${p} / ${pageCount}`, W - M, 290, { align: "right" })
  }

  doc.save(`bilan-${params.fileNameSuffix}.pdf`)
}
