import { jsPDF } from "jspdf"
import { Prisma, DonorType, OrganismeCategory } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { organismeCategoryLabel } from "@/lib/organisme-category"

type DonForReceipt = {
  id:           string
  donorType?:   DonorType
  firstName:    string
  lastName:     string
  companyName?: string | null
  siret?:       string | null
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
  objet?:             string | null
  organismeCategory?: OrganismeCategory
}

async function assignReceiptNumber(donId: string, associationId: string): Promise<string> {
  const year   = new Date().getFullYear()
  const prefix = `${year}-`

  // Read-max-then-write-next races when two donations for the same association are
  // receipted concurrently. `@@unique([associationId, receiptNumber])` turns that race
  // into a constraint violation instead of a silent duplicate — retry with a freshly
  // re-read max on conflict.
  for (let attempt = 0; attempt < 5; attempt++) {
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

    try {
      await prisma.don.update({
        where: { id: donId },
        data:  { receiptNumber, receiptIssuedAt: new Date() },
      })
      return receiptNumber
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue
      throw err
    }
  }

  throw new Error("Impossible d'attribuer un numéro de reçu fiscal unique")
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

  // Un reçu fiscal doit toujours porter l'identité réelle du donateur — l'option
  // « anonyme » ne masque que son éventuelle apparition dans un futur affichage
  // public, jamais ce document ni les registres internes de l'association.
  doc.setFont("helvetica", "normal")
  doc.text(`Nom : ${don.firstName} ${don.lastName}`, M, y); y += 6
  if (don.address) {
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

export async function generateRecuFiscalEntreprise(
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
  doc.text("REÇU DES DONS ET VERSEMENTS DES ENTREPRISES", M, 10)
  doc.setFontSize(9)
  doc.setFont("helvetica", "normal")
  doc.text("Article 238 bis du Code Général des Impôts", M, 16)
  doc.text(`N° ${receiptNumber}`, W - M, 10, { align: "right" })
  doc.text("Cerfa n° 16216*03", W - M, 16, { align: "right" })

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
  if (association.objet) {
    const objetLines = doc.splitTextToSize(`Objet : ${association.objet}`, W - 2 * M) as string[]
    doc.text(objetLines, M, y)
    y += objetLines.length * 5
  }
  doc.text(
    `Catégorie : ${organismeCategoryLabel(association.organismeCategory ?? "ASSOCIATION_LOI_1901")}`,
    M, y,
  )
  y += 6

  // ── Entreprise donatrice ─────────────────────────────────────────────────
  y += 4
  doc.setFont("helvetica", "bold")
  doc.setFontSize(10)
  doc.text("ENTREPRISE DONATRICE", M, y)
  y += 5
  doc.line(M, y, W - M, y)
  y += 6

  doc.setFont("helvetica", "normal")
  const donorName = don.companyName ?? `${don.firstName} ${don.lastName}`
  doc.text(`Dénomination : ${donorName}`, M, y); y += 6
  if (don.siret) {
    doc.text(`SIREN/SIRET : ${don.siret}`, M, y); y += 6
  }
  if (don.address) {
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
  doc.text("Nature du don : Versement", M, y); y += 6
  doc.text("Forme du versement : Virement, prélèvement ou carte bancaire", M, y); y += 6

  // ── Avantage fiscal ──────────────────────────────────────────────────────
  y += 6
  doc.setFillColor(239, 246, 255)
  doc.roundedRect(M, y, W - 2 * M, 24, 2, 2, "F")
  doc.setFont("helvetica", "bold")
  doc.setFontSize(9)
  doc.text("AVANTAGE FISCAL (Art. 238 bis CGI)", M + 4, y + 6)
  doc.setFont("helvetica", "normal")
  doc.setFontSize(8.5)
  const taxText1 = "60 % de réduction d'impôt dans la limite de 0,5 % du chiffre d'affaires HT"
  const taxText2 = "(ou 20 000 € si ce montant est plus élevé), taux réduit à 40 % au-delà de 2 M€ de dons."
  const taxText3 = "L'excédent est reportable sur les 5 exercices suivants."
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
    "Ce reçu est délivré conformément à l'article 238 bis du Code Général des Impôts. " +
    "L'association atteste que ce don ne lui confère aucune contrepartie. " +
    "Conserver ce document pour la déclaration fiscale de l'entreprise."
  doc.text(doc.splitTextToSize(footer, W - 2 * M), M, 278)

  return Buffer.from(doc.output("arraybuffer"))
}

export async function generateRecuFiscalForDon(
  don: DonForReceipt,
  association: AssociationForReceipt,
): Promise<Buffer> {
  return don.donorType === "COMPANY"
    ? generateRecuFiscalEntreprise(don, association)
    : generateRecuFiscal(don, association)
}
