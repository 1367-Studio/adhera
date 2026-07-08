import { PDFDocument, PDFName, PDFDict, StandardFonts } from "pdf-lib"
import fs from "fs"
import { Prisma, DonorType, OrganismeCategory } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { amountToFrenchWords } from "@/lib/pdf/french-numbers"

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
  organismeCategoryDetail?: string | null
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

// Coordonnees (issues de `pdftotext -bbox` sur le gabarit officiel, voir historique de
// session) -- ce PDF n'a aucun champ de formulaire (contrairement au 2041-mec-sd), le
// texte est donc superpose aux positions exactes du document, page par page.
const RD_PAGE_HEIGHT = 842

const RD_CATEGORY_POSITION: Partial<Record<OrganismeCategory, { page: number; x: number; y: number }>> = {
  ASSOCIATION_LOI_1901:                            { page: 0, x: 54, y: 342 },
  FONDATION_RECONNUE_UTILITE_PUBLIQUE:             { page: 0, x: 54, y: 356 },
  FONDATION_UNIVERSITAIRE_PARTENARIALE:            { page: 0, x: 54, y: 392 },
  FONDATION_ENTREPRISE:                            { page: 0, x: 54, y: 417 },
  MUSEE_DE_FRANCE:                                 { page: 0, x: 54, y: 431 },
  AIDE_ALIMENTAIRE_SOCIALE:                        { page: 0, x: 54, y: 445 },
  AUTRE_INTERET_GENERAL:                           { page: 0, x: 54, y: 495 },
  ASSOCIATION_CULTUELLE_ALSACE_MOSELLE:            { page: 0, x: 38, y: 511 },
  FONDS_DOTATION:                                  { page: 0, x: 38, y: 528 },
  ETABLISSEMENT_ENSEIGNEMENT_SUPERIEUR:            { page: 0, x: 38, y: 574 },
  ETABLISSEMENT_ENSEIGNEMENT_SUPERIEUR_CONSULAIRE: { page: 0, x: 38, y: 602 },
  ORGANISME_AIDE_PME:                              { page: 0, x: 38, y: 620 },
  ORGANISME_SPECTACLE_EXPOSITIONS:                 { page: 0, x: 38, y: 648 },
  FONDATION_PATRIMOINE:                            { page: 0, x: 38, y: 688 },
  ORGANISME_PROTECTION_BIENS_CULTURELS:            { page: 0, x: 38, y: 727 },
  ORGANISME_RECHERCHE_SCIENTIFIQUE:                { page: 1, x: 38, y: 25 },
  ORGANISME_UE_SIMILAIRE:                          { page: 1, x: 38, y: 176 },
}

export async function generateRecuFiscal(
  don: DonForReceipt,
  association: AssociationForReceipt,
): Promise<Buffer> {
  const receiptNumber = don.receiptNumber
    ?? await assignReceiptNumber(don.id, association.id)

  const amount    = parseFloat(don.amount.toString())
  const paidAt    = don.paidAt ?? new Date()
  const dateStr   = paidAt.toLocaleDateString("fr-FR")
  const amountWords = amountToFrenchWords(amount)

  const templateBytes = fs.readFileSync(new URL("./templates/2041-rd.pdf", import.meta.url))
  const doc   = await PDFDocument.load(templateBytes)
  const pages = doc.getPages()
  const font  = await doc.embedFont(StandardFonts.Helvetica)

  const put = (pageIdx: number, text: string, x: number, yTopDown: number, size = 9) => {
    const safeText = text.replace(/[\u00a0\u202f\u2009\u2007]/g, " ")
    pages[pageIdx].drawText(safeText, { x, y: RD_PAGE_HEIGHT - yTopDown, size, font })
  }
  const mark = (pageIdx: number, x: number, yTopDown: number) => put(pageIdx, "X", x, yTopDown + 8, 9)

  // ── Page 1 : organisme bénéficiaire ────────────────────────────────────────
  put(0, receiptNumber, 445, 120)
  put(0, association.name, 36, 178)
  const identifier = association.siren ?? association.rna ?? ""
  if (identifier) put(0, identifier, 198, 189)
  put(0, [association.address, association.city].filter(Boolean).join(", "), 135, 218)
  put(0, "France", 65, 244)
  if (association.objet) put(0, association.objet, 70, 256)

  const category = association.organismeCategory ?? "ASSOCIATION_LOI_1901"
  const pos = RD_CATEGORY_POSITION[category]
  if (pos) mark(pos.page, pos.x, pos.y)

  // ── Page 2 : donateur, montant, signature ──────────────────────────────────
  const donorName = `${don.firstName} ${don.lastName}`
  put(1, donorName, 65, 250)
  if (don.address) put(1, don.address, 136, 281)

  put(1, amount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), 75, 363)
  put(1, amountWords, 355, 363)
  put(1, dateStr, 183, 385)

  mark(1, 98, 440)   // "200 du CGI" (réduction d'impôt sur le revenu, pas l'IFI)
  mark(1, 290, 478)  // Forme du don : Déclaration de don manuel
  mark(1, 34, 515)   // Nature du don : Numéraire
  mark(1, 290, 583)  // Mode de versement : Virement, prélèvement, carte bancaire

  put(1, dateStr, 315, 638)

  return Buffer.from(await doc.save())
}

// Champs du Cerfa 16216*03 officiel (src/lib/pdf/templates/2041-mec-sd.pdf), reverse-engineered
// widget par widget (voir historique de session) car ils ne sont pas nommés sémantiquement.
// Les 4 champs CAC2/CAC3/CAC4/CAC5 ont été désolidarisés de leurs doublons "Forme des
// versements" (PAY_ESPECES/PAY_CHEQUE/PAY_VIREMENT/PAY_AUTRE) — dans le PDF d'origine ils
// partageaient le même champ malgré des valeurs "on" différentes par widget, ce qui empêchait
// de cocher une catégorie et un moyen de versement en même temps.
const CATEGORY_FIELD: Record<OrganismeCategory, { field: string; onValue?: string }> = {
  ASSOCIATION_LOI_1901:                            { field: "CAC0", onValue: "1" },
  FONDATION_RECONNUE_UTILITE_PUBLIQUE:             { field: "CAC0", onValue: "2" },
  FONDATION_UNIVERSITAIRE_PARTENARIALE:            { field: "CAC0", onValue: "3" },
  FONDATION_ENTREPRISE:                            { field: "CAC0", onValue: "4" },
  MUSEE_DE_FRANCE:                                 { field: "CAC0", onValue: "5" },
  AIDE_ALIMENTAIRE_SOCIALE:                        { field: "CAC0", onValue: "6" },
  AUTRE_INTERET_GENERAL:                           { field: "CAC0", onValue: "7" },
  ASSOCIATION_CULTUELLE_ALSACE_MOSELLE:            { field: "CAC2" },
  ETABLISSEMENT_ENSEIGNEMENT_SUPERIEUR:            { field: "CAC3" },
  ETABLISSEMENT_ENSEIGNEMENT_SUPERIEUR_CONSULAIRE: { field: "CAC4" },
  ORGANISME_RECHERCHE_SCIENTIFIQUE:                { field: "CAC5" },
  ORGANISME_SPECTACLE_EXPOSITIONS:                 { field: "CAC6" },
  PROJET_THESE_DOCTORAT:                           { field: "CAC7" },
  SOCIETE_EXPOSITIONS_UNIVERSELLES:                { field: "CAC8" },
  SOCIETE_PROGRAMME_AUDIOVISUEL:                   { field: "CAC9" },
  FONDATION_PATRIMOINE:                            { field: "CAC11" },
  FONDS_DOTATION:                                  { field: "CAC12" },
  ORGANISME_AIDE_PME:                              { field: "CAC13" },
  FEDERATION_ORGANISMES_AGREES:                    { field: "CAC14" },
  ORGANISME_PROTECTION_BIENS_CULTURELS:            { field: "CAC15" },
  ORGANISME_UE_SIMILAIRE:                          { field: "CAC16" },
}

// Champ "date de l'agrément" associé à certaines catégories (rempli avec organismeCategoryDetail).
const CATEGORY_DETAIL_FIELD: Partial<Record<OrganismeCategory, string>> = {
  AUTRE_INTERET_GENERAL:      "a14",
  ORGANISME_RECHERCHE_SCIENTIFIQUE: "a15",
  FONDATION_PATRIMOINE:       "a16",
  ORGANISME_AIDE_PME:         "b1",
  FEDERATION_ORGANISMES_AGREES: "b2",
  ORGANISME_UE_SIMILAIRE:     "b3",
}

// Coche un widget précis d'un champ à plusieurs valeurs "on" (ex: CAC0, dont les 7 widgets
// représentent chacun une sous-catégorie différente) sans passer par checkBox.check(), qui ne
// gère qu'une seule valeur "on" partagée par tous les widgets.
function checkExclusiveWidget(doc: PDFDocument, fieldName: string, onValue: string) {
  const form  = doc.getForm()
  const field = form.getCheckBox(fieldName)
  field.acroField.dict.set(PDFName.of("V"), PDFName.of(onValue))
  for (const widget of field.acroField.getWidgets()) {
    const ap = widget.dict.lookupMaybe(PDFName.of("AP"), PDFDict)
    const n  = ap?.lookupMaybe(PDFName.of("N"), PDFDict)
    const hasValue = n?.keys().some(k => k.toString() === `/${onValue}`) ?? false
    widget.dict.set(PDFName.of("AS"), PDFName.of(hasValue ? onValue : "Off"))
  }
}

export async function generateRecuFiscalEntreprise(
  don: DonForReceipt,
  association: AssociationForReceipt,
): Promise<Buffer> {
  const receiptNumber = don.receiptNumber
    ?? await assignReceiptNumber(don.id, association.id)

  const amount    = parseFloat(don.amount.toString())
  const paidAt    = don.paidAt ?? new Date()
  const dateStr   = paidAt.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })
  const amountWords = amountToFrenchWords(amount)

  const templateBytes = fs.readFileSync(new URL("./templates/2041-mec-sd.pdf", import.meta.url))
  const doc  = await PDFDocument.load(templateBytes)
  const form = doc.getForm()

  const set = (name: string, value: string) => {
    // La police standard (WinAnsi) ne sait pas encoder certains caractères Unicode que
    // toLocaleString("fr-FR") produit (ex: espace fine insécable   entre milliers).
    const safeValue = value.replace(/[\u00a0\u202f\u2009\u2007]/g, " ")
    try {
      form.getTextField(name).setText(safeValue)
    } catch (err) {
      // Erreur attendue si le champ n'existe pas ou depasse sa longueur max (ex: b6
      // limite a 9 caracteres pour le SIREN) - ne jamais avaler l'erreur en silence.
      console.error(`[recu-fiscal] failed to set field "${name}":`, err)
    }
  }

  set("a1", receiptNumber)
  set("a2", association.name)
  set("a4", association.siren ?? association.rna ?? "")
  set("a6", association.address ?? "")
  set("a8", association.city ?? "")
  set("a9", "France")
  set("a10", association.objet ?? "")

  const category = association.organismeCategory ?? "ASSOCIATION_LOI_1901"
  const cat = CATEGORY_FIELD[category]
  if (cat.onValue) {
    checkExclusiveWidget(doc, cat.field, cat.onValue)
    // La sous-catégorie coche aussi la case "Œuvre ou organisme d'intérêt général" globale.
    form.getCheckBox("CAC1").check()
  } else {
    form.getCheckBox(cat.field).check()
  }
  const detailField = CATEGORY_DETAIL_FIELD[category]
  if (detailField && association.organismeCategoryDetail) set(detailField, association.organismeCategoryDetail)

  const donorName = don.companyName ?? `${don.firstName} ${don.lastName}`
  set("b4", donorName)
  set("b6", (don.siret ?? "").slice(0, 9)) // champ "Numéro SIREN" — 9 chiffres, pas le SIRET complet
  set("b8", don.address ?? "")

  set("b15", amount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
  set("b16", amountWords)
  set("b18", amount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
  set("b19", amountWords)
  set("b21", dateStr)
  set("b27", dateStr)

  // Le paiement passe toujours par Stripe (carte) — jamais espèces/chèque/autre.
  form.getCheckBox("PAY_VIREMENT").check()

  form.flatten()
  return Buffer.from(await doc.save())
}

export async function generateRecuFiscalForDon(
  don: DonForReceipt,
  association: AssociationForReceipt,
): Promise<Buffer> {
  return don.donorType === "COMPANY"
    ? generateRecuFiscalEntreprise(don, association)
    : generateRecuFiscal(don, association)
}
