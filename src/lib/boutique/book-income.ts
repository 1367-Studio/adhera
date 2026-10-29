import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { getOrCreateDefaultCategory } from "@/lib/finance/resolve-default-category"

type TxClient = Prisma.TransactionClient

export type BoutiqueIncomeItem = { quantity: number; unitPrice: number; categoryId: string | null; produitName: string }

// Shared by every path that flips a BoutiqueCommande to PAID — the manual "Encaisser" action
// (PATCH /api/boutique/commandes/[id]), the Stripe webhook (checkout.session.completed), and
// the admin "compra manual" creation route. One Income row per accounting category plus one for
// shipping, grouped by the category snapshot taken when each item was ordered (not the
// product's current category) so recategorizing a product later doesn't retroactively change
// how an already-placed order books to Finances.
export async function bookBoutiqueOrderIncome(tx: TxClient, params: {
  associationId:        string
  exerciceId:            string | null
  membreId:              string | null | undefined
  commandeId:            string
  items:                 BoutiqueIncomeItem[]
  shippingCost:           number
  shippingCarrierLabel:   string | null
  buyerLabel:             string | null
  paymentMethod:          "STRIPE" | "ESPECES" | "CHEQUE" | "CB" | "VIREMENT"
  paidAt:                 Date
  // STRIPE webhook rows carry the PaymentIntent id as Income.reference — manual rows have none.
  reference?:             string | null
}) {
  const { associationId, exerciceId, membreId, commandeId, items, shippingCost, shippingCarrierLabel, buyerLabel, paymentMethod, paidAt, reference } = params

  const byCategory = new Map<string | null, { amount: number; names: Set<string> }>()
  for (const item of items) {
    const key   = item.categoryId
    const group = byCategory.get(key) ?? { amount: 0, names: new Set<string>() }
    group.amount += item.unitPrice * item.quantity
    group.names.add(item.produitName)
    byCategory.set(key, group)
  }

  // A BoutiqueProduit with no accounting category of its own falls back to the "boutique"
  // default bucket (707) instead of staying fully uncategorized — a product-level category,
  // when set, still wins (see the groupBy above, keyed on each item's own snapshot).
  // Resolved via the plain `prisma` client, deliberately not `tx` — the caller's transaction is
  // already open by the time this function runs, and getOrCreateDefaultCategory's P2002-race
  // retry needs a connection that isn't already aborted by a prior failed statement in it (see
  // that function's doc comment). Nothing above this line can throw, so there's no risk of this
  // write surviving a rollback of the Income rows below.
  const fallbackCategoryId = [...byCategory.keys()].some(k => k === null)
    ? await getOrCreateDefaultCategory(prisma, associationId, "boutique")
    : null

  for (const [categoryId, group] of byCategory) {
    const itemsLabel = [...group.names].join(", ")
    await tx.income.create({
      data: {
        associationId,
        exerciceId:    exerciceId ?? null,
        memberId:      membreId ?? undefined,
        commandeId,
        amount:        group.amount / 100,
        categoryId:    categoryId ?? fallbackCategoryId ?? undefined,
        description:   buyerLabel ? `Vente boutique — ${buyerLabel} — ${itemsLabel}` : `Vente boutique — ${itemsLabel}`,
        paymentMethod,
        source:        paymentMethod === "STRIPE" ? "STRIPE" : "MANUAL",
        status:        "PAID",
        date:          paidAt,
        ...(reference ? { reference } : {}),
      },
    })
  }

  // Shipping is its own Income line, deliberately uncategorized (same "no category" convention
  // as an item with a null categoryId snapshot) — it must never get silently folded into a
  // product category's total.
  if (shippingCost > 0) {
    await tx.income.create({
      data: {
        associationId,
        exerciceId:    exerciceId ?? null,
        memberId:      membreId ?? undefined,
        commandeId,
        amount:        shippingCost / 100,
        description:   buyerLabel
          ? `Frais de livraison — ${buyerLabel}${shippingCarrierLabel ? ` (${shippingCarrierLabel})` : ""}`
          : `Frais de livraison${shippingCarrierLabel ? ` (${shippingCarrierLabel})` : ""}`,
        paymentMethod,
        source:        paymentMethod === "STRIPE" ? "STRIPE" : "MANUAL",
        status:        "PAID",
        date:          paidAt,
        ...(reference ? { reference } : {}),
      },
    })
  }
}
