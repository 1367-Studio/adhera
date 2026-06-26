import { jsPDF } from "jspdf"
import { prisma } from "@/lib/prisma/client"

type DonForReceipt = {
  id:           string
  firstName:    string
  lastName:     string
  address:      string | null
  amount:       { toString(): string }
  paidAt:       Date | null
  anonymous:    boolean
  receiptNumber: string | null
  receiptIssuedAt: Date | null
}

type AssociationForReceipt = {
  id:                 string
  name:               string
  address:            string | null
  city:               string | null
  siren:              string | null
  rna:                string | null
  canIssueTaxReceipts: boolean
}

async function assignReceiptNumber(donId: string, associationId: string): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = `${year}-`

  const last = await prisma.don.findFirst({
    where: {
      associationId,
      receiptNumber: { startsWith: prefix },
      paidAt: { not: null },
    },
    orderBy: { receiptNumber: "desc" },
    select: { receiptNumber: true },
  })

  let seq = 1
  if (last?.receiptNumber) {
    const num = parseInt(last.receiptNumber.split("-")[1] ?? "0", 10)
    seq = num + 1
  }

  const receiptNumber = `${prefix}${String(seq).padStart(4, "0")}`

  await prisma.don.update({
    where: { id: donId },
    data:  { receiptNumber, receiptIssuedAt: new Date() },
  })

  return receiptNumber
}

export async function generateRecuFiscal(
  don: DonForReceipt,
  association: AssociationForReceipt,
): Promise<Buffer> {
  const receiptNumber = don.receiptNumber
    ?? await assignReceiptNumber(don.id, association.id)

  const amount    = parseFloat(don.amount.toString())
  const amountStr = amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
  const dateStr   = (don.paidAt ?? new Date()).toLocaleDateString("fr-FR", {
    day: "numeric", month: "long", year: "numeric",
  })

  const doc = new jsPDF({ unit: "mm", format: "a4" })
  const W   = 210
  const M   = 15

  // ── Header ───────────────────────────────────────────────────────────────
  doc.setFillColor(79, 70, 229)
  doc.rect(0, 0, W, 22, "F")
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(13)
  doc.setFont("helvetica", "bold")
  doc.text("REÇU AU TITRE DES DONS", M, 10)
  doc.setFontSize(9)
  doc.setFont("helvetica", "normal")
  doc.text("Article 200 du Code Général des Impôts", M, 16)
  doc.text(`N° ${receiptNumber}`, W - M, 10, { align: "right" })
  doc.text("Cerfa n° 11580*05", W - M, 16, { align: "right" })

  doc.setTextColor(0, 0, 0)

  // ── Organisme bénéficiaire ────────────────────────────────────────────────
  let y = 32
  doc.setFontSize(10)
  doc.setFont("helvetica", "bold")
  doc.text("ORGANISME BÉNÉFICIAIRE", M, y)
  y += 5
  doc.setDrawColor(200, 200, 200)
  doc.line(M, y, W - M, y)
  y += 6

  doc.setFont("helvetica", "normal")
  doc.setFontSize(10)
  doc.text(`Nom : ${association.name}`, M, y); y += 6
  if (association.address) {
    doc.text(`Adresse : ${association.address}`, M, y); y += 6
  }
  if (association.city) {
    doc.text(`Ville : ${association.city}`, M, y); y += 6
  }
  const identifier = association.siren
    ? `SIREN : ${association.siren}`
    : association.rna
      ? `RNA : ${association.rna}`
      : ""
  if (identifier) {
    doc.text(identifier, M, y); y += 6
  }

  // ── Donateur ─────────────────────────────────────────────────────────────
  y += 4
  doc.setFont("helvetica", "bold")
  doc.setFontSize(10)
  doc.text("DONATEUR / DONATRICE", M, y)
  y += 5
  doc.line(M, y, W - M, y)
  y += 6

  doc.setFont("helvetica", "normal")
  const donorName = don.anonymous ? "Donateur anonyme" : `${don.firstName} ${don.lastName}`
  doc.text(`Nom : ${donorName}`, M, y); y += 6
  if (!don.anonymous && don.address) {
    doc.text(`Adresse : ${don.address}`, M, y); y += 6
  }

  // ── Don ──────────────────────────────────────────────────────────────────
  y += 4
  doc.setFont("helvetica", "bold")
  doc.setFontSize(10)
  doc.text("DÉTAIL DU DON", M, y)
  y += 5
  doc.line(M, y, W - M, y)
  y += 6

  doc.setFont("helvetica", "normal")
  doc.text(`Montant : ${amountStr}`, M, y); y += 6
  doc.text(`Date du versement : ${dateStr}`, M, y); y += 6
  doc.text("Nature du don : Versement en numéraire", M, y); y += 6
  doc.text("Forme du don : Don manuel", M, y); y += 6

  // ── Avantage fiscal ──────────────────────────────────────────────────────
  y += 6
  doc.setFillColor(239, 246, 255)
  doc.roundedRect(M, y, W - 2 * M, 24, 2, 2, "F")
  doc.setFont("helvetica", "bold")
  doc.setFontSize(9)
  doc.text("AVANTAGE FISCAL (Art. 200 CGI)", M + 4, y + 6)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8.5)
  const taxText1 = "75 % de réduction d'impôt sur le revenu dans la limite de 1 000 €,"
  const taxText2 = "puis 66 % pour le reste, dans la limite de 20 % du revenu imposable."
  const taxText3 = "L'excédent est reportable sur les 5 années suivantes."
  doc.text(taxText1, M + 4, y + 12)
  doc.text(taxText2, M + 4, y + 17)
  doc.text(taxText3, M + 4, y + 22)
  y += 30

  // ── Signature ────────────────────────────────────────────────────────────
  y += 8
  doc.setFont("helvetica", "normal")
  doc.setFontSize(9)
  doc.text("Fait à _____________, le " + (don.paidAt ?? new Date()).toLocaleDateString("fr-FR"), M, y)
  y += 10
  doc.text("Signature et cachet de l'association :", M, y)
  y += 18
  doc.line(M, y, M + 70, y)
  doc.setFontSize(8)
  doc.setTextColor(100, 100, 100)
  doc.text(association.name, M, y + 4)

  // ── Footer ────────────────────────────────────────────────────────────────
  doc.setTextColor(130, 130, 130)
  doc.setFontSize(7.5)
  const footer =
    "Ce reçu est délivré conformément à l'article 200 du Code Général des Impôts. " +
    "L'association atteste que ce don ne lui confère aucune contrepartie. " +
    "Conserver ce document pour votre déclaration de revenus."
  doc.text(doc.splitTextToSize(footer, W - 2 * M), M, 278)

  return Buffer.from(doc.output("arraybuffer"))
}
