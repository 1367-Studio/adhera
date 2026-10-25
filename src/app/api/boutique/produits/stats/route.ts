import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { guardModule } from "@/lib/auth/require-module"
import { withAdminAuth } from "@/lib/api-wrapper"
import { rankTopSellingProducts } from "@/lib/boutique/sales-stats"

// Best-selling products for the Boutique page's Produits tab, all-time (that tab has no
// period filter). Only items of PAID commandes count — online and manual alike, net of
// refunds since the refund route lowers item quantities in place.
export const GET = withAdminAuth(async (req, ctx) => {
  const guard = await guardModule(ctx.associationId, "boutique")
  if (guard) return guard

  // Grouped by unit price too: Prisma's groupBy can sum quantities but not
  // quantity × unitPrice, so revenue is rebuilt per price in rankTopSellingProducts. The
  // number of groups stays small (products × distinct prices), whatever the order volume.
  const salesGroups = await prisma.boutiqueCommandeItem.groupBy({
    by:    ["produitId", "unitPrice"],
    where: { quantity: { gt: 0 }, commande: { associationId: ctx.associationId, status: "PAID" } },
    _sum:  { quantity: true },
  })

  const topSellingProducts = rankTopSellingProducts(salesGroups.map(salesGroup => ({
    produitId:    salesGroup.produitId,
    unitPrice:    salesGroup.unitPrice,
    quantitySold: salesGroup._sum.quantity ?? 0,
  })))

  const produits = topSellingProducts.length
    ? await prisma.boutiqueProduit.findMany({
        where:  { id: { in: topSellingProducts.map(product => product.produitId) }, associationId: ctx.associationId },
        select: { id: true, name: true },
      })
    : []
  const nameById = new Map(produits.map(produit => [produit.id, produit.name]))

  return NextResponse.json({
    // Amounts in integer cents, like every other boutique amount.
    topProducts: topSellingProducts
      .filter(product => nameById.has(product.produitId))
      .map(product => ({ ...product, name: nameById.get(product.produitId)! })),
  })
}, { area: "boutique" })
