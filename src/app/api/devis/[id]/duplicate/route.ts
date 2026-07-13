import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { nextDevisNumber } from "@/lib/document-numbering"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export const POST = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const source = await prisma.devis.findFirst({
    where:   { id, associationId, deletedAt: null },
    include: { items: { orderBy: { order: "asc" } } },
  })
  if (!source) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 })

  // A duplicate always starts a fresh lifecycle — brouillon, issued today, no validity/
  // response dates carried over — rather than cloning the source's current status/dates,
  // which would make it look like it was already sent/answered.
  for (let attempt = 0; attempt < 5; attempt++) {
    const number = await nextDevisNumber(associationId)
    try {
      const devis = await prisma.devis.create({
        data: {
          associationId,
          fournisseurId:  source.fournisseurId,
          number,
          status:         "BROUILLON",
          issueDate:      new Date(),
          validUntil:     null,
          subtotal:       source.subtotal,
          vatAmount:      source.vatAmount,
          discountAmount: source.discountAmount,
          total:          source.total,
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

      await writeActivityLog({ associationId, actorId: userId, action: "DEVIS_DUPLICATED", entity: "Devis", entityId: devis.id, label: devis.number, metadata: { sourceId: source.id, sourceNumber: source.number } })

      return NextResponse.json(devis, { status: 201 })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue
      throw err
    }
  }

  return NextResponse.json({ error: "Impossible de générer un numéro de devis, réessayez" }, { status: 500 })
}, { roles: FINANCE, module: "devis" })
