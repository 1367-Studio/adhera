// Thrown inside the stock-check loop of the public storefront checkout/commande routes so
// the catch block can return which exact line(s) ran short, instead of a single opaque
// error string — lets the cart auto-clamp to what's actually available rather than leaving
// the buyer to guess which item to reduce and resubmit blind.
export class InsufficientStockError extends Error {
  constructor(
    public varianteId: string,
    label: string,
    public available: number,
  ) {
    super(`Stock insuffisant pour "${label}" (disponible: ${available})`)
    this.name = "InsufficientStockError"
  }
}
