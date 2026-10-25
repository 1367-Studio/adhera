import { describe, expect, it } from "vitest"
import {
  kpiStatusForFilter,
  parseCommandeStatus,
  rankTopSellingProducts,
  type CommandeStatus,
  type ProductSalesGroup,
} from "@/lib/boutique/sales-stats"

// Minimal stand-in for the rows the KPI queries read — same fields, same meaning as
// BoutiqueCommande / BoutiqueCommandeItem (amounts in cents).
type CommandeFixture = {
  status:      CommandeStatus
  totalAmount: number
  items:       { produitId: string; quantity: number; unitPrice: number }[]
}

// What the database does for us in production, reproduced in memory: the commandes list's
// aggregate (count + sum of totalAmount where status = kpiStatusForFilter(filter)) and the
// stats route's groupBy (items of PAID commandes grouped by product and unit price).
function aggregateKpis(commandes: CommandeFixture[], statusFilter?: CommandeStatus) {
  const kpiStatus = kpiStatusForFilter(statusFilter)
  const matchingCommandes = commandes.filter(commande => commande.status === kpiStatus)
  return {
    kpiCount:       matchingCommandes.length,
    kpiAmountCents: matchingCommandes.reduce((sum, commande) => sum + commande.totalAmount, 0),
  }
}

function groupPaidItems(commandes: CommandeFixture[]): ProductSalesGroup[] {
  const groups = new Map<string, ProductSalesGroup>()
  for (const commande of commandes.filter(candidate => candidate.status === "PAID")) {
    for (const item of commande.items) {
      const groupKey = `${item.produitId}:${item.unitPrice}`
      const group = groups.get(groupKey) ?? { produitId: item.produitId, unitPrice: item.unitPrice, quantitySold: 0 }
      group.quantitySold += item.quantity
      groups.set(groupKey, group)
    }
  }
  return [...groups.values()]
}

// The product owner's scenarios, each in the state the app leaves it in.
const onlineOrder: CommandeFixture = {
  status: "PAID", totalAmount: 2000 + 490, // one t-shirt + shipping
  items:  [{ produitId: "tshirt", quantity: 1, unitPrice: 2000 }],
}
const manualOrder: CommandeFixture = {
  status: "PAID", totalAmount: 1500,
  items:  [{ produitId: "mug", quantity: 1, unitPrice: 1500 }],
}
const multiProductOrder: CommandeFixture = {
  status: "PAID", totalAmount: 3 * 2000 + 2 * 500,
  items:  [
    { produitId: "tshirt",  quantity: 3, unitPrice: 2000 },
    { produitId: "sticker", quantity: 2, unitPrice: 500 },
  ],
}
const cancelledOrder: CommandeFixture = {
  status: "CANCELLED", totalAmount: 1500,
  items:  [{ produitId: "mug", quantity: 1, unitPrice: 1500 }],
}
const pendingOrder: CommandeFixture = {
  status: "PENDING", totalAmount: 4000,
  items:  [{ produitId: "tshirt", quantity: 2, unitPrice: 2000 }],
}
// Ordered 2 mugs + 1 cap, refunded 1 mug and the cap: the refund route lowered the
// quantities (cap line left at 0) and totalAmount, and the order stays PAID.
const partiallyRefundedOrder: CommandeFixture = {
  status: "PAID", totalAmount: 1500,
  items:  [
    { produitId: "mug", quantity: 1, unitPrice: 1500 },
    { produitId: "cap", quantity: 0, unitPrice: 1200 },
  ],
}
// Every item refunded: quantities at 0, totalAmount at 0 and status CANCELLED.
const fullyRefundedOrder: CommandeFixture = {
  status: "CANCELLED", totalAmount: 0,
  items:  [{ produitId: "tshirt", quantity: 0, unitPrice: 2000 }],
}

const allOrders = [
  onlineOrder, manualOrder, multiProductOrder, cancelledOrder,
  pendingOrder, partiallyRefundedOrder, fullyRefundedOrder,
]

describe("kpiStatusForFilter", () => {
  it("counts PAID commandes (sales) when no status filter or the PAID filter is active", () => {
    expect(kpiStatusForFilter(undefined)).toBe("PAID")
    expect(kpiStatusForFilter("PAID")).toBe("PAID")
  })

  it("follows a non-paid status filter, so the cards describe the filtered list", () => {
    expect(kpiStatusForFilter("PENDING")).toBe("PENDING")
    expect(kpiStatusForFilter("CANCELLED")).toBe("CANCELLED")
  })
})

describe("parseCommandeStatus", () => {
  it("accepts the three statuses and ignores anything else", () => {
    expect(parseCommandeStatus("PAID")).toBe("PAID")
    expect(parseCommandeStatus("PENDING")).toBe("PENDING")
    expect(parseCommandeStatus("CANCELLED")).toBe("CANCELLED")
    expect(parseCommandeStatus("paid")).toBeUndefined()
    expect(parseCommandeStatus("")).toBeUndefined()
    expect(parseCommandeStatus(null)).toBeUndefined()
  })
})

describe("commandes KPIs", () => {
  it("counts each PAID commande once and sums its net totalAmount (shipping included)", () => {
    // online + manual + multi-product + partially refunded = 4 sales.
    expect(aggregateKpis(allOrders)).toEqual({
      kpiCount:       4,
      kpiAmountCents: 2490 + 1500 + 7000 + 1500,
    })
  })

  it("gives the same sales figures with the PAID filter as with no filter", () => {
    expect(aggregateKpis(allOrders, "PAID")).toEqual(aggregateKpis(allOrders))
  })

  it("counts and sums the listed commandes under the pending filter", () => {
    expect(aggregateKpis(allOrders, "PENDING")).toEqual({ kpiCount: 1, kpiAmountCents: 4000 })
  })

  // Cancelled + fully refunded (CANCELLED, totalAmount lowered to 0) — the sum is exactly
  // what the list's Total column shows for those rows.
  it("counts and sums the listed commandes under the cancelled filter", () => {
    expect(aggregateKpis(allOrders, "CANCELLED")).toEqual({ kpiCount: 2, kpiAmountCents: 1500 })
  })

  it("is 0 with no commandes", () => {
    expect(aggregateKpis([])).toEqual({ kpiCount: 0, kpiAmountCents: 0 })
  })
})

describe("rankTopSellingProducts", () => {
  it("ranks the scenarios by units sold, net of refunds, excluding cancelled and pending orders", () => {
    expect(rankTopSellingProducts(groupPaidItems(allOrders))).toEqual([
      { produitId: "tshirt",  quantitySold: 4, revenueCents: 8000 },
      { produitId: "mug",     quantitySold: 2, revenueCents: 3000 },
      { produitId: "sticker", quantitySold: 2, revenueCents: 1000 },
      // "cap" was fully refunded on a still-PAID order: quantity 0, so no tile.
    ])
  })

  it("folds a product sold at several prices back into one total", () => {
    expect(rankTopSellingProducts([
      { produitId: "hoodie", unitPrice: 3000, quantitySold: 2 },
      { produitId: "hoodie", unitPrice: 3500, quantitySold: 1 },
    ])).toEqual([{ produitId: "hoodie", quantitySold: 3, revenueCents: 9500 }])
  })

  it("breaks a quantity tie by revenue", () => {
    const ranked = rankTopSellingProducts([
      { produitId: "cheap",     unitPrice: 100,  quantitySold: 5 },
      { produitId: "expensive", unitPrice: 1000, quantitySold: 5 },
    ])
    expect(ranked.map(product => product.produitId)).toEqual(["expensive", "cheap"])
  })

  it("keeps only the 4 best sellers", () => {
    const salesGroups = ["a", "b", "c", "d", "e", "f"].map((produitId, index) => ({
      produitId, unitPrice: 1000, quantitySold: index + 1,
    }))
    expect(rankTopSellingProducts(salesGroups).map(product => product.produitId)).toEqual(["f", "e", "d", "c"])
  })

  it("returns nothing when nothing was sold", () => {
    expect(rankTopSellingProducts([])).toEqual([])
    expect(rankTopSellingProducts(groupPaidItems([cancelledOrder, pendingOrder, fullyRefundedOrder]))).toEqual([])
  })
})
