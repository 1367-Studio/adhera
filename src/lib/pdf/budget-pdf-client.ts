// src/lib/pdf/budget-pdf-client.ts
import { BASE_PATH } from "@/lib/env"
import { loadLogoForPdf } from "@/lib/pdf/branded-header-client"
import { budgetDiff, budgetDiffPercent } from "@/lib/finance/budget-format"
import type { BudgetExportRow } from "@/lib/finance/budget-export-shared"
import type { AssociationPlan } from "@prisma/client"

type AssociationBranding = {
  name: string
  plan: AssociationPlan
  customBrandingEnabled: boolean | null
  logoUrl: string | null
}

export interface BudgetPdfParams {
  title:            string // "Orçamento previsto — Global" or "... — <nom du projet>"
  exerciceLabel:    string
  periodLabel?:     string
  previstoLabel:    string
  realizadoLabel:   string
  diffPercentLabel: string
  rows:             BudgetExportRow[]
  fileNameSuffix:   string
}

// Same WinAnsi narrow-no-break-space fix as income-statement-pdf-client.ts, and the same
// "-0 € becomes 0 €" fix for an empty section total.
const fmt = (n: number) => (n === 0 ? 0 : n).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }).replace(/[  ]/g, " ")

function fmtDiffPercent(previsto: number, realizado: number) {
  const diff    = budgetDiff(previsto, realizado)
  const percent = budgetDiffPercent(previsto, realizado)
  return `${fmt(diff === 0 ? 0 : diff)} · ${percent === null ? "—" : `${Math.round(percent)}%`}`
}

export async function exportBudgetPdf(params: BudgetPdfParams) {
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
  doc.text(`Exercice ${params.exerciceLabel}`, M, y)
  y += 5
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
    head:   [["", params.previstoLabel, params.realizadoLabel, params.diffPercentLabel]],
    body:   params.rows.map(r => [
      r.label,
      r.previsto === null ? "" : fmt(r.previsto),
      r.realizado === null ? "" : fmt(r.realizado),
      r.previsto === null || r.realizado === null ? "" : fmtDiffPercent(r.previsto, r.realizado),
    ]),
    columnStyles: { 1: { halign: "right" }, 2: { halign: "right" }, 3: { halign: "right" } },
    headStyles: { fillColor: [255, 255, 255], textColor: [24, 24, 27], fontStyle: "bold", fontSize: 9, lineColor: [24, 24, 27], lineWidth: { bottom: 0.4 } },
    bodyStyles: { fontSize: 9, textColor: [24, 24, 27] },
    styles:     { cellPadding: 2, lineColor: [228, 228, 231], lineWidth: 0.1 },
    didParseCell: (data) => {
      if (data.section === "body" && boldRowIndexes.has(data.row.index)) {
        data.cell.styles.fontStyle = "bold"
      }
    },
  })

  const pageCount = doc.getNumberOfPages()
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p)
    doc.setFontSize(7)
    doc.setTextColor(...ZINC)
    doc.text(`Page ${p} / ${pageCount}`, W - M, 290, { align: "right" })
  }

  doc.save(`budget-previsionnel-${params.fileNameSuffix}.pdf`)
}
