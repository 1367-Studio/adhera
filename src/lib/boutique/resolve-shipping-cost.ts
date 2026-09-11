import { prisma } from "@/lib/prisma/client"
import { getShippingRates, applyShippingMarkup } from "@/lib/boutique/shipping-rate"

export class ShippingUnavailableError extends Error {}

// Never trusts the price the client sent — re-quotes from scratch (same call the cart's
// rate-preview endpoint makes) and only accepts the option whose `code` still matches what
// the buyer picked. Called just before the stock-reservation transaction in each
// checkout/commande route, not inside it — this does a network call, which has no business
// holding a DB transaction open.
export async function resolveShippingCost(params: {
  associationId:  string
  items:          { varianteId: string; quantity: number }[]
  destCountry:    string
  destPostalCode: string
  optionCode:     string
  // The price (cents) the buyer saw and agreed to pay for `optionCode`. Rejected below if a
  // fresh quote for that same code comes back at a different price — e.g. the association
  // changed its shipping markup, or the carrier's own rate moved, between the buyer loading
  // the cart and submitting the order. Without this check that drift would be charged
  // silently instead of prompting the buyer to see the new price first.
  expectedCostCents: number
}): Promise<{ costCents: number; carrierLabel: string }> {
  const assoc = await prisma.association.findUnique({
    where:  { id: params.associationId },
    select: { shippingCountry: true, shippingPostalCode: true, shippingMarkupPercent: true },
  })
  if (!assoc?.shippingCountry || !assoc.shippingPostalCode)
    throw new ShippingUnavailableError("La livraison postale n'est pas configurée par cette association")

  const variantes = await prisma.boutiqueVariante.findMany({
    where:  { id: { in: params.items.map(i => i.varianteId) }, produit: { associationId: params.associationId } },
    select: { id: true, shippable: true, weightGrams: true },
  })
  const varianteMap = new Map(variantes.map(v => [v.id, v]))

  let weightGrams = 0
  for (const item of params.items) {
    const v = varianteMap.get(item.varianteId)
    if (!v || !v.shippable || !v.weightGrams)
      throw new ShippingUnavailableError("Un article du panier ne peut pas être livré par la poste")
    weightGrams += v.weightGrams * item.quantity
  }

  const rawOptions = await getShippingRates({
    originCountry:    assoc.shippingCountry,
    originPostalCode: assoc.shippingPostalCode,
    destCountry:      params.destCountry,
    destPostalCode:   params.destPostalCode,
    weightGrams,
  })
  const options = applyShippingMarkup(rawOptions, assoc.shippingMarkupPercent)
  const match = options.find(o => o.code === params.optionCode)
  if (!match || match.costCents !== params.expectedCostCents)
    throw new ShippingUnavailableError("Cette option de livraison n'est plus disponible, merci de recalculer le frais de port")

  return { costCents: match.costCents, carrierLabel: match.carrierLabel }
}
