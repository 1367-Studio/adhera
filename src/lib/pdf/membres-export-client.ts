// src/lib/pdf/membres-export-client.ts
import { toast } from "sonner"
import { format } from "date-fns"
import { BASE_PATH } from "@/lib/env"
import { loadLogoForPdf, hexToRgb255 } from "@/lib/pdf/branded-header-client"

type AssociationBranding = {
  name: string
  plan: "ESSENTIAL" | "PRO"
  customBrandingEnabled: boolean | null
  logoUrl: string | null
  primaryColor: string | null
}

export async function exportMembresPdf(params: URLSearchParams) {
  params.set("format", "json")

  const [dataRes, assocRes] = await Promise.all([
    fetch(`${BASE_PATH}/api/membres/export?${params}`),
    fetch(`${BASE_PATH}/api/association`),
  ])

  if (!dataRes.ok) {
    toast.error("Erreur lors de la génération du PDF")
    return
  }
  const rows: Record<string, string | number>[] = await dataRes.json()
  if (rows.length === 0) {
    toast.error("Aucun membre à exporter")
    return
  }

  const assoc: AssociationBranding | null = assocRes.ok ? await assocRes.json() : null


  const { default: jsPDF }     = await import("jspdf")
  const { default: autoTable } = await import("jspdf-autotable")

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape" })
  const W     = 297
  const M     = 12
  const ZINC  = [113, 113, 122] as [number, number, number]
  const today = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })

  // Same Pro-gated branding rule as presences/declaration — see canUseCustomBranding().
  const canBrand = assoc ? (assoc.customBrandingEnabled ?? assoc.plan === "PRO") : false
  const headerRgb: [number, number, number] =
    (canBrand && assoc?.primaryColor && hexToRgb255(assoc.primaryColor)) || [0, 0, 0]
  const logo = canBrand && assoc?.logoUrl ? await loadLogoForPdf(`${BASE_PATH}/api/association/branding/logo`) : null

// ── Header ─────────────────────────────────────────────────────────────
let y = 20

if (logo) {
  const logoH = 16
  const logoW = logo.width * (logoH / logo.height)
  doc.addImage(logo.dataUrl, logo.format, M, y - logoH + 4, logoW, logoH)
  y += 4
}

doc.setTextColor(24, 24, 27)
doc.setFontSize(13)
doc.setFont("helvetica", "bold")
doc.text(assoc?.name ?? "Association", M, y + 14)

doc.setTextColor(...headerRgb)
doc.setFontSize(14)
doc.setFont("helvetica", "bold")
doc.text("LISTE DES MEMBRES", W - M, y + 8, { align: "right" })

y += 22

doc.setDrawColor(...headerRgb)
doc.setLineWidth(0.5)
doc.line(M, y, W - M, y)
y += 8

doc.setFontSize(8)
doc.setFont("helvetica", "normal")
doc.setTextColor(113, 113, 122)
doc.text(`Généré le ${today}`, M, y)
doc.text(`${rows.length} membre${rows.length !== 1 ? "s" : ""}`, W - M, y, { align: "right" })
y += 8

  // ── Table ──────────────────────────────────────────────────────────────
  const head = Object.keys(rows[0])
  const body = rows.map(r => head.map(k => String(r[k] ?? "")))

  // A landscape A4 page comfortably fits ~13 narrow columns at size 7 — the "full" ficha
  // export (src/app/api/membres/export/route.ts's ?full=1) adds several more, which would
  // otherwise squeeze every column and wrap most cells onto multiple lines.
  const fontSize = head.length > 13 ? 6 : 7
  const cellPadding = head.length > 13 ? 1.5 : 2

  autoTable(doc, {
    startY:             y,
    margin:             { left: M, right: M },
    head:               [head],
    body,
    headStyles: { fillColor: [255, 255, 255], textColor: [24, 24, 27], fontStyle: "bold", fontSize },
    bodyStyles:         { fontSize, textColor: [24, 24, 27] },
    alternateRowStyles: { fillColor: [250, 250, 250] },
    styles:             { cellPadding, lineColor: [228, 228, 231], lineWidth: 0.1, overflow: "linebreak" },
  })

  const pageCount = doc.getNumberOfPages()
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p)
    doc.setFontSize(7)
    doc.setTextColor(...ZINC)
    doc.text(`Page ${p} / ${pageCount}`, W - M, 205, { align: "right" })
  }

  doc.save(`membres_${format(new Date(), "yyyy-MM-dd")}.pdf`)
}
