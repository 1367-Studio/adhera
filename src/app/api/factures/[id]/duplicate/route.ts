import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { nextFactureNumber } from "@/lib/document-numbering"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export const POST = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const source = await prisma.facture.findFirst({
    where:   { id, associationId, deletedAt: null },
    include: { items: { orderBy: { order: "asc" } } },
  })
  if (!source) return NextResponse.json({ error: "Facture introuvable" }, { status: 404 })

  // A duplicate always starts a fresh lifecycle — brouillon, issued today, no due date,
  // nothing paid — and never carries over `devisId`: that column is @unique on Facture,
  // so copying the link would collide with the original the moment both exist.
  for (let attempt = 0; attempt < 5; attempt++) {
    const number = await nextFactureNumber(associationId)
    try {
      const facture = await prisma.facture.create({
        data: {
          associationId,
          fournisseurId:  source.fournisseurId,
          devisId:        null,
          number,
          status:         "BROUILLON",
          issueDate:      new Date(),
          dueDate:        null,
          subtotal:       source.subtotal,
          vatAmount:      source.vatAmount,
          discountAmount: source.discountAmount,
          total:          source.total,
          amountPaid:     0,
          notes:          source.notes,
          paymentTerms:   source.paymentTerms,
          items: {
            create: source.items.map((item) => ({
              description: item.description,
              quantity:    item.quantity,
              unitPrice:   item.unitPrice,
              vatRate:     item.vatRate,
              discount:    item.discount,
              order:       item.order,
            })),
          },
        },
        include: { items: true, fournisseur: { select: { id: true, companyName: true } } },
      })

      await writeActivityLog({ associationId, actorId: userId, action: "FACTURE_DUPLICATED", entity: "Facture", entityId: facture.id, label: facture.number, metadata: { sourceId: source.id, sourceNumber: source.number } })

      return NextResponse.json(facture, { status: 201 })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue
      throw err
    }
  }

  return NextResponse.json({ error: "Impossible de générer un numéro de facture, réessayez" }, { status: 500 })
}, { roles: FINANCE, module: "factures" })
