// A sold-out tier isn't actually purchasable — advertising its price as "from" would be
// misleading, so prefer tiers that still have room and only fall back to every tier
// (including sold-out ones) if the whole event is sold out anyway.
export function cheapestAvailableTicketTypePrice(ticketTypes: { price: string | number; full: boolean }[]): number {
  const available = ticketTypes.filter(tt => !tt.full)
  const pool = available.length > 0 ? available : ticketTypes
  return Math.min(...pool.map(tt => Number(tt.price)))
}
