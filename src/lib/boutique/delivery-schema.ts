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
}

type DeliveryFields = {
  deliveryMethod: "PICKUP" | "DELIVERY"
  shippingAddress?: string
  shippingCity?: string
  shippingPostalCode?: string
  shippingCountry?: string
  shippingOptionCode?: string
}

export function validateDeliveryFields(data: DeliveryFields): string | null {
  if (data.deliveryMethod !== "DELIVERY") return null
  if (!data.shippingAddress || !data.shippingCity || !data.shippingPostalCode || !data.shippingCountry || !data.shippingOptionCode)
    return "Adresse de livraison et option de frais de port requises"
  return null
}
