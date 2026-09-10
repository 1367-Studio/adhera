import { prisma } from "@/lib/prisma/client"
import { getShippingRates } from "@/lib/boutique/shipping-rate"

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
}): Promise<{ costCents: number; carrierLabel: string }> {
  const assoc = await prisma.association.findUnique({
    where:  { id: params.associationId },
    select: { shippingCountry: true, shippingPostalCode: true },
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

  const options = await getShippingRates({
    originCountry:    assoc.shippingCountry,
    originPostalCode: assoc.shippingPostalCode,
    destCountry:      params.destCountry,
    destPostalCode:   params.destPostalCode,
    weightGrams,
  })
  const match = options.find(o => o.code === params.optionCode)
  if (!match)
    throw new ShippingUnavailableError("Cette option de livraison n'est plus disponible, merci de recalculer le frais de port")

  return { costCents: match.costCents, carrierLabel: match.carrierLabel }
}
