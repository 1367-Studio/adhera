import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { nextBoutiqueReceiptNumber } from "@/lib/document-numbering"
import { resolveExerciceForDate } from "@/lib/finance/exercice"

interface ProductLine { varianteId: string; quantity: number }

// Mirrors inscription/route.ts's commonMeta.products shape ({ v, q } — minimal keys only, same
// convention as membership-form-products.ts's own parseProducts).
function parseProducts(productsJson: string | undefined): ProductLine[] {
  if (!productsJson) return []
  try {
    const parsed: unknown = JSON.parse(productsJson)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((p): p is { v: string; q: number } => typeof p?.v === "string" && typeof p?.q === "number")
      .map(p => ({ varianteId: p.v, quantity: p.q }))
  } catch {
    return []
  }
}

export interface PurchasedProductLine { label: string; quantity: number; amount: number }
export interface ProductPurchaseResult {
  purchased:        PurchasedProductLine[]
  flaggedOversells: { varianteId: string; quantity: number }[]
}

// Mirror exact de createMembershipFormProductPurchase (voir ce fichier pour le raisonnement
// détaillé) — étape séparée délibérée, après que le webhook a déjà confirmé le paiement du
// billet lui-même (voir src/app/api/webhook/stripe/route.ts, branche orderId). Un échec ici
// (rupture de stock, ou l'étape entière après ses tentatives) n'annule jamais le billet déjà
// payé — même philosophie "l'argent a déjà bougé" que côté adhésion.
export async function createEvenementProductPurchase(params: {
  associationId:   string
  participationId: string
  membreId:        string | null
  guestName:       string
  guestEmail:      string | null
  paymentIntentId: string | null
  productsJson:    string | undefined
}): Promise<ProductPurchaseResult | null> {
  const lines = parseProducts(params.productsJson)
  if (lines.length === 0) return null

  const paidAt = new Date()

  for (let attempt = 0; attempt < 5; attempt++) {
    const receiptNumber = await nextBoutiqueReceiptNumber(params.associationId)
    try {
      return await prisma.$transaction(async tx => {
        const flaggedOversells: { varianteId: string; quantity: number }[] = []
        const accepted: { varianteId: string; produitId: string; categoryId: string | null; label: string; quantity: number; unitPrice: number }[] = []

        for (const line of lines) {
          const variante = await tx.boutiqueVariante.findUnique({
            where:  { id: line.varianteId },
            select: { id: true, label: true, price: true, produitId: true, produit: { select: { categoryId: true } } },
          })
          if (!variante) { flaggedOversells.push(line); continue }

          // Décompte atomique conditionnel — même raisonnement que
          // createMembershipFormProductPurchase : count === 0 signifie stock insuffisant,
          // l'argent a déjà été capturé, donc le billet n'est jamais bloqué pour ça.
          const { count } = await tx.boutiqueVariante.updateMany({
            where: { id: line.varianteId, stock: { gte: line.quantity } },
            data:  { stock: { decrement: line.quantity } },
          })
          if (count === 0) { flaggedOversells.push(line); continue }

          accepted.push({
            varianteId: variante.id, produitId: variante.produitId, categoryId: variante.produit.categoryId,
            label: variante.label, quantity: line.quantity, unitPrice: variante.price,
          })
        }

        if (accepted.length === 0) return { purchased: [], flaggedOversells }

        const exercice = await resolveExerciceForDate(params.associationId, paidAt)

        await tx.boutiqueCommande.create({
          data: {
            associationId:         params.associationId,
            membreId:              params.membreId,
            guestName:             params.membreId ? null : params.guestName,
            guestEmail:            params.membreId ? null : params.guestEmail,
            participationId:       params.participationId,
            status:                "PAID",
            source:                "EVENEMENT",
            paymentMethod:         "STRIPE",
            stripePaymentIntentId: params.paymentIntentId,
            receiptNumber,
            paidAt,
            totalAmount: accepted.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0),
            items: {
              create: accepted.map(l => ({
                produitId: l.produitId, varianteId: l.varianteId, categoryId: l.categoryId,
                quantity: l.quantity, unitPrice: l.unitPrice,
              })),
            },
          },
        })

        // Une ligne d'Income par catégorie, même logique de regroupement que
        // createMembershipFormProductPurchase.
        const byCategory = new Map<string | null, number>()
        for (const l of accepted) byCategory.set(l.categoryId, (byCategory.get(l.categoryId) ?? 0) + l.unitPrice * l.quantity)
        const itemsLabel = accepted.map(l => l.label).join(", ")
        for (const [categoryId, amountCents] of byCategory) {
          await tx.income.create({
            data: {
              associationId:   params.associationId,
              exerciceId:      exercice?.status === "OUVERT" ? exercice.id : null,
              memberId:        params.membreId,
              participationId: params.participationId,
              amount:          amountCents / 100,
              categoryId:      categoryId ?? undefined,
              description:     `Vente boutique (événement) — ${itemsLabel}`,
              paymentMethod:   "STRIPE",
              source:          "STRIPE",
              status:          "PAID",
              date:            paidAt,
              reference:       params.paymentIntentId ?? undefined,
            },
          })
        }

        return {
          purchased: accepted.map(l => ({ label: l.label, quantity: l.quantity, amount: (l.unitPrice * l.quantity) / 100 })),
          flaggedOversells,
        }
      })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && attempt < 4) continue
      throw err
    }
  }
  // Unreachable in practice (the loop above always returns or throws), needed only so every
  // path has an explicit return.
  return null
}
