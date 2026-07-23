import jsPDF from "jspdf"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"

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
}

async function assignDeclarationNumber(cotisationId: string, associationId: string): Promise<string> {
  const year   = new Date().getFullYear()
  const prefix = `${year}-`

  for (let attempt = 0; attempt < 5; attempt++) {
    const last = await prisma.cotisation.findFirst({
      where: {
        associationId,
        declarationNumber: { startsWith: prefix },
      },
      orderBy: { declarationNumber: "desc" },
      select: { declarationNumber: true },
    })

    let seq = 1
    if (last?.declarationNumber) {
      const num = parseInt(last.declarationNumber.split("-")[1] ?? "0", 10)
      seq = num + 1
    }

    const declarationNumber = `${prefix}${String(seq).padStart(4, "0")}`

    try {
      await prisma.cotisation.update({
        where: { id: cotisationId },
        data:  { declarationNumber, declarationIssuedAt: new Date() },
      })
      return declarationNumber
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue
      throw err
    }
  }

  throw new Error("Impossible d'attribuer un numéro de déclaration unique")
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

  const doc = new jsPDF()

  doc.setFontSize(16)
  doc.text("Déclaration de cotisation", 20, 25)

  doc.setFontSize(10)
  doc.text(`N° ${declarationNumber}`, 20, 33)

  doc.setFontSize(11)
  doc.text(association.name, 20, 50)
  if (association.address || association.city) {
    doc.text([association.address, association.city].filter(Boolean).join(", "), 20, 57)
  }

  doc.text("Membre :", 20, 75)
  doc.text(`${membre.firstName} ${membre.lastName}`, 60, 75)
  if (membre.address) {
    doc.text("Adresse :", 20, 82)
    doc.text(membre.address, 60, 82)
  }

  doc.text("Année de cotisation :", 20, 95)
  doc.text(String(cotisation.year), 90, 95)

  doc.text("Montant :", 20, 102)
  doc.text(`${amount.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`, 90, 102)

  doc.text("Date de paiement :", 20, 109)
  doc.text(dateStr, 90, 109)

  doc.setFontSize(9)
  doc.text(
    "Cette déclaration atteste du paiement de la cotisation annuelle mentionnée ci-dessus.",
    20, 130,
  )

  return Buffer.from(doc.output("arraybuffer"))
}
