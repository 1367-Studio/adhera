import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { nextCotisationDeclarationNumber } from "@/lib/document-numbering"
import { PDFDocument, StandardFonts, rgb } from "pdf-lib"

type CotisationForDeclaration = {
  id:                  string
  year:                number
  amount:              { toString(): string }
  paidAt:              Date | null
  declarationNumber:   string | null
  declarationIssuedAt: Date | null
}

type MembreForDeclaration = {
  firstName: string
  lastName:  string
  address:   string | null
}

type AssociationForDeclaration = {
  id:      string
  name:    string
  address: string | null
  city:    string | null
  logoUrl: string | null
  primaryColor: string | null
}

async function assignDeclarationNumber(cotisationId: string, associationId: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const declarationNumber = await nextCotisationDeclarationNumber(associationId)

    try {
      // Guard on `declarationNumber: null` so two concurrent requests for the *same*
      // cotisation (e.g. a double-click) can't both "win" and burn two numbers on one
      // payment — the loser matches zero rows here and falls through to reuse whatever
      // number the winner assigned, instead of retrying with a fresh one.
      const result = await prisma.cotisation.updateMany({
        where: { id: cotisationId, declarationNumber: null },
        data:  { declarationNumber, declarationIssuedAt: new Date() },
      })
      if (result.count === 1) return declarationNumber

      const current = await prisma.cotisation.findUniqueOrThrow({
        where:  { id: cotisationId },
        select: { declarationNumber: true },
      })
      return current.declarationNumber!
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue
      throw err
    }
  }

  throw new Error("Impossible d'attribuer un numéro de déclaration unique")
}

function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return null
  const n = parseInt(m[1], 16)
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255)
}

export async function generateDeclarationCotisation(
  cotisation:  CotisationForDeclaration,
  membre:      MembreForDeclaration,
  association: AssociationForDeclaration,
): Promise<Buffer> {
  const declarationNumber = cotisation.declarationNumber
    ?? await assignDeclarationNumber(cotisation.id, association.id)

  const amount  = parseFloat(cotisation.amount.toString())
  const paidAt  = cotisation.paidAt ?? new Date()
  const dateStr = paidAt.toLocaleDateString("fr-FR")

  const doc  = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const ACCENT = (association.primaryColor && hexToRgb(association.primaryColor)) || rgb(0.45, 0.45, 0.45)

  let logoImage = null
  if (association.logoUrl) {
    try {
      const res   = await fetch(association.logoUrl)
      const bytes = new Uint8Array(await res.arrayBuffer())
      const contentType = res.headers.get("content-type") ?? ""
      logoImage = contentType.includes("png") ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
    } catch {
      logoImage = null // logo optional — never fail the export over a broken image
    }
  }

  const page = doc.addPage([595.28, 841.89])
let y = 841.89 - 50

function text(str: string, x: number, size = 10, opts: { bold?: boolean; color?: ReturnType<typeof rgb> } = {}) {
  page.drawText(str, { x, y, size, font: opts.bold ? bold : font, color: opts.color ?? rgb(0.1, 0.1, 0.1) })
}

function textRight(str: string, rightX: number, size = 10, opts: { bold?: boolean; color?: ReturnType<typeof rgb> } = {}) {
  const f = opts.bold ? bold : font
  text(str, rightX - f.widthOfTextAtSize(str, size), size, opts)
}

// ── Header ─────────────────────────────────────────────────────────────
textRight("DÉCLARATION DE COTISATION", 545, 16, { bold: true, color: ACCENT })

if (logoImage) {
  const maxW = 140, maxH = 50
  const scale = Math.min(maxW / logoImage.width, maxH / logoImage.height, 1)
  page.drawImage(logoImage, { x: 20, y: y - logoImage.height * scale + 2, width: logoImage.width * scale, height: logoImage.height * scale })
  y -= logoImage.height * scale + 14
}

text(association.name, 20, 14, { bold: true })
y -= 18
page.drawLine({ start: { x: 20, y }, end: { x: 575, y }, thickness: 1, color: ACCENT })
y -= 22

text(`N° ${declarationNumber}`, 20, 10)
y -= 22

  if (association.address || association.city) {
    text([association.address, association.city].filter(Boolean).join(", "), 20, 10)
    y -= 20
  }

  text("Membre :", 20, 10)
  text(`${membre.firstName} ${membre.lastName}`, 90, 10)
  y -= 14
  if (membre.address) {
    text("Adresse :", 20, 10)
    text(membre.address, 90, 10)
    y -= 14
  }

  y -= 8
  text("Année de cotisation :", 20, 10)
  text(String(cotisation.year), 130, 10)
  y -= 18

  text("Montant :", 20, 10)
  text(`${amount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`, 130, 10)
  y -= 18

  text("Date de paiement :", 20, 10)
  text(dateStr, 130, 10)
  y -= 32

  text("Cette déclaration atteste du paiement de la cotisation annuelle mentionnée ci-dessus.", 20, 9, { color: rgb(0.45, 0.45, 0.45) })

  return Buffer.from(await doc.save())
}
