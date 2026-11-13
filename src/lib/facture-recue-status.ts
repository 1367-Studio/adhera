export type FactureRecueStatus = "A_PAYER" | "PARTIELLEMENT_PAYEE" | "PAYEE" | "EN_LITIGE" | "ANNULEE"

const EPSILON = 0.01

// Mirrors resolveManualStatus (src/lib/facture-status.ts, Facture/emitted side) exactly —
// PAYEE/PARTIELLEMENT_PAYEE are consequences of amountPaid vs amount, the same way the
// payments endpoints set them when a FactureRecuePayment is added or removed (FORM-107
// Fase 3). Trusting an arbitrary client-sent value for these two would let the badge lie
// about whether the balance is actually settled. A_PAYER/EN_LITIGE/ANNULEE stay fully manual.
export function resolveManualFactureRecueStatus(
  status:     FactureRecueStatus,
  amountPaid: number,
  amount:     number,
): FactureRecueStatus {
  if (status !== "PAYEE" && status !== "PARTIELLEMENT_PAYEE") return status
  if (amountPaid <= EPSILON) return "A_PAYER"
  return amountPaid >= amount - EPSILON ? "PAYEE" : "PARTIELLEMENT_PAYEE"
}
