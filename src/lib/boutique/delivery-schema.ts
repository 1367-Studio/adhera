import { z } from "zod"

// Spread into each checkout/commande route's own z.object({...}) shape — kept as plain
// field defs (not a full schema) so each route can still add its own other fields and a
// single superRefine via validateDeliveryFields below.
export const deliveryFieldsSchema = {
  deliveryMethod:     z.enum(["PICKUP", "DELIVERY"]).default("PICKUP"),
  shippingAddress:    z.string().trim().max(300).optional(),
  shippingCity:       z.string().trim().max(100).optional(),
  shippingPostalCode: z.string().trim().max(12).optional(),
  shippingCountry:    z.string().trim().length(2).optional(),
  // The Sendcloud option `code` the buyer picked in the cart's rate list — re-verified
  // against a fresh quote server-side in resolveShippingCost, never trusted for the price.
  shippingOptionCode: z.string().optional(),
  // The price (in cents) the buyer actually saw for that code. resolveShippingCost rejects
  // the order if the freshly re-quoted price for the same code has drifted from this —
  // otherwise a markup change (or real carrier price movement) between quote and submit
  // would silently charge a different amount than what was shown in the cart.
  shippingOptionCostCents: z.number().int().nonnegative().optional(),
}

type DeliveryFields = {
  deliveryMethod: "PICKUP" | "DELIVERY"
  shippingAddress?: string
  shippingCity?: string
  shippingPostalCode?: string
  shippingCountry?: string
  shippingOptionCode?: string
  shippingOptionCostCents?: number
}

export function validateDeliveryFields(data: DeliveryFields): string | null {
  if (data.deliveryMethod !== "DELIVERY") return null
  // costCents can legitimately be 0 (a free option), so this checks presence, not truthiness.
  if (!data.shippingAddress || !data.shippingCity || !data.shippingPostalCode || !data.shippingCountry
    || !data.shippingOptionCode || data.shippingOptionCostCents === undefined)
    return "Adresse de livraison et option de frais de port requises"
  return null
}
