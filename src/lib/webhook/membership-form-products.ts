import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { nextBoutiqueReceiptNumber } from "@/lib/document-numbering"
import { resolveExerciceForDate } from "@/lib/finance/exercice"

interface ProductLine { varianteId: string; quantity: number }

// Mirrors checkout/route.ts's commonMeta.products shape ({ v, q } — minimal keys only, see
// that file's comment for why label/price aren't snapshotted here the way resolvedAddons is).
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

// Deliberately run as a separate step AFTER handleMembershipOneOffCheckout's own
// User/Membre/Cotisation transaction has already committed — never nested inside it.
// nextBoutiqueReceiptNumber queries via the raw `prisma` client (not a tx), so a receipt-
// number collision here can only be resolved by retrying this transaction, and doing that
// from inside the membership-creation transaction would roll back an already-paid signup over
// an unrelated numbering race. See membership-forms.ts for how a total failure here (after
// every retry) is treated as a non-blocking, staff-notified edge case, same as the oversell
// case below — the membership itself is never undone once created.
export async function createMembershipFormProductPurchase(params: {
  associationId:   string
  membreId:        string
  cotisationId:    string
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

          // Décompte atomique conditionnel — la même ligne peut avoir été achetée entre le
          // POST du checkout (validation légère, voir checkout/route.ts) et l'arrivée de ce
          // webhook. count === 0 signifie stock insuffisant : l'argent a déjà été capturé
          // (voir handleMembershipOneOffCheckout), donc on ne bloque jamais l'adhésion pour
          // ça — la ligne est simplement écartée et signalée à l'équipe.
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
            cotisationId:          params.cotisationId,
            status:                "PAID",
            source:                "MEMBERSHIP_FORM",
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

        // Une ligne d'Income par catégorie, même logique de regroupement que le bloc
        // générique de checkout.session.completed (src/app/api/webhook/stripe/route.ts) pour
        // un achat Boutique classique — dupliquée ici plutôt que partagée : ce webhook-ci n'a
        // ni PaymentIntent à relire ni reçu PDF à construire, le contexte diffère trop pour
        // qu'une fonction commune reste simple.
        const byCategory = new Map<string | null, number>()
        for (const l of accepted) byCategory.set(l.categoryId, (byCategory.get(l.categoryId) ?? 0) + l.unitPrice * l.quantity)
        const itemsLabel = accepted.map(l => l.label).join(", ")
        for (const [categoryId, amountCents] of byCategory) {
          await tx.income.create({
            data: {
              associationId: params.associationId,
              exerciceId:    exercice?.status === "OUVERT" ? exercice.id : null,
              memberId:      params.membreId,
              amount:        amountCents / 100,
              categoryId:    categoryId ?? undefined,
              description:   `Vente boutique (adhésion) — ${itemsLabel}`,
              paymentMethod: "STRIPE",
              source:        "STRIPE",
              status:        "PAID",
              date:          paidAt,
              reference:     params.paymentIntentId ?? undefined,
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
