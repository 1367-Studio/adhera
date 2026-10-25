// Boutique KPIs (dashboard Boutique page) — the rules both tabs share, kept pure so they can
// be unit-tested without a database. The queries themselves live in api/boutique/commandes
// (Commandes tab cards) and api/boutique/produits/stats (top products); they only feed these
// helpers.
//
// A "sale" is a PAID commande, online (STRIPE) or manual alike, whatever its source. Refunds
// (api/boutique/commandes/[id]/refund) rewrite the order in place — item quantities and
// totalAmount go down, a full refund flips it to CANCELLED — so the current PAID rows are
// already net of refunds and nothing here has to subtract them again.

// Order lines that count as sold: on a PAID commande of this association, and not refunded
// down to 0. Shared by the top-products tiles and the Produits table's « Ventes » column, so
// the two always show the same number for a product.
export function paidSalesItemWhere(associationId: string) {
  return { quantity: { gt: 0 }, commande: { associationId, status: "PAID" as const } }
}

export const COMMANDE_STATUSES = ["PENDING", "PAID", "CANCELLED"] as const
export type CommandeStatus = (typeof COMMANDE_STATUSES)[number]

export function parseCommandeStatus(value: string | null | undefined): CommandeStatus | undefined {
  return COMMANDE_STATUSES.find(status => status === value)
}

// Which commandes the Commandes tab cards count (number + sum of totalAmount): the selected
// status filter, or PAID when "Toutes" is selected. Only the PAID figures are sales and
// revenue (« Nombre de ventes » / « Revenu total »); with "En attente" or "Annulée" the cards
// describe what the filtered list contains (« Commandes en attente » / « Montant annulé »…),
// so they always agree with the rows and the list's Total column.
export function kpiStatusForFilter(statusFilter: CommandeStatus | undefined): CommandeStatus {
  return statusFilter ?? "PAID"
}

// One row per (product, unit price) pair, as returned by a groupBy over the items of PAID
// commandes — a product sold at several prices over time (price change, variants) shows up
// as several rows, folded back together below.
export type ProductSalesGroup = {
  produitId:    string
  unitPrice:    number
  quantitySold: number
}

export type TopSellingProduct = {
  produitId:    string
  quantitySold: number
  revenueCents: number
}

export const TOP_SELLING_PRODUCTS_LIMIT = 4

// Ranks products by units sold (tie-break: revenue, then id for a stable order). Revenue is
// quantity × unitPrice (cents) — shipping is not attributed to any product, and there is no
// discount feature to subtract. A line left at quantity 0 by a partial refund contributes
// nothing, and a product with nothing left sold is dropped rather than shown as a 0 tile.
export function rankTopSellingProducts(
  salesGroups: ProductSalesGroup[],
  limit: number = TOP_SELLING_PRODUCTS_LIMIT,
): TopSellingProduct[] {
  const totalsByProduct = new Map<string, TopSellingProduct>()
  for (const salesGroup of salesGroups) {
    const productTotals = totalsByProduct.get(salesGroup.produitId)
      ?? { produitId: salesGroup.produitId, quantitySold: 0, revenueCents: 0 }
    productTotals.quantitySold += salesGroup.quantitySold
    productTotals.revenueCents += salesGroup.quantitySold * salesGroup.unitPrice
    totalsByProduct.set(salesGroup.produitId, productTotals)
  }

  return [...totalsByProduct.values()]
    .filter(productTotals => productTotals.quantitySold > 0)
    .sort((first, second) =>
      second.quantitySold - first.quantitySold
      || second.revenueCents - first.revenueCents
      || first.produitId.localeCompare(second.produitId),
    )
    .slice(0, limit)
}
