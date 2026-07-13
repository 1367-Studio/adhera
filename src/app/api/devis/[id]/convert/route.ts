import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { guardModule } from "@/lib/auth/require-module"
import { writeActivityLog } from "@/lib/activity-log"
import { nextFactureNumber } from "@/lib/document-numbering"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export const POST = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const facturesGuard = await guardModule(associationId, "factures")
  if (facturesGuard) return facturesGuard

  const devis = await prisma.devis.findFirst({
    where:   { id, associationId, deletedAt: null },
    include: { items: { orderBy: { order: "asc" } } },
  })
  if (!devis) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 })
  if (devis.status !== "ACCEPTE") {
    return NextResponse.json({ error: "Seul un devis accepté peut être converti en facture" }, { status: 409 })
  }

  // Facture is a to-one back-relation, so `include` can't filter it by deletedAt directly —
  // query it separately so a soft-deleted Facture doesn't block a legitimate reconversion.
  const activeFacture = await prisma.facture.findFirst({ where: { devisId: id, deletedAt: null }, select: { id: true } })
  if (activeFacture) {
    return NextResponse.json({ error: "Ce devis a déjà été converti en facture" }, { status: 409 })
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const number = await nextFactureNumber(associationId)
    try {
      const facture = await prisma.facture.create({
        data: {
          associationId,
          fournisseurId:  devis.fournisseurId,
          devisId:        devis.id,
          number,
          status:         "EN_ATTENTE",
          issueDate:      new Date(),
          subtotal:       devis.subtotal,
          vatAmount:       devis.vatAmount,
          discountAmount: devis.discountAmount,
          total:          devis.total,
          notes:          devis.notes,
          paymentTerms:   devis.paymentTerms,
          items: {
            create: devis.items.map((item) => ({
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

      await writeActivityLog({ associationId, actorId: userId, action: "DEVIS_CONVERTED", entity: "Devis", entityId: devis.id, label: devis.number, metadata: { factureId: facture.id, factureNumber: facture.number } })
      await writeActivityLog({ associationId, actorId: userId, action: "FACTURE_CREATED_FROM_DEVIS", entity: "Facture", entityId: facture.id, label: facture.number, metadata: { devisId: devis.id, devisNumber: devis.number } })

      return NextResponse.json(facture, { status: 201 })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        // devisId is @unique on Facture — a concurrent request already converted this devis
        // between our check above and this insert. Report the real conflict instead of
        // burning retries re-generating a facture number that was never the problem.
        const target = Array.isArray(err.meta?.target) ? err.meta.target : []
        if (target.includes("devisId")) {
          return NextResponse.json({ error: "Ce devis a déjà été converti en facture" }, { status: 409 })
        }
        continue
      }
      throw err
    }
  }

  return NextResponse.json({ error: "Impossible de générer un numéro de facture, réessayez" }, { status: 500 })
}, { roles: FINANCE, module: "devis" })
