export type DevisStatus = "BROUILLON" | "ENVOYE" | "ACCEPTE" | "REFUSE" | "EXPIRE"

// validUntil is stored at UTC midnight of the chosen calendar day (from a plain
// <input type=date>) — compare calendar days, not exact instants, for the same reason
// facture-status.ts does for dueDate.
function startOfUtcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

// Unlike Facture's EN_RETARD, EXPIRE is still a real, manually-settable DevisStatus (a
// devis can be marked expired by hand at any time, validUntil or not). This only adds
// automatic derivation on top: an ENVOYE devis whose validUntil has passed reads as
// "Expiré" without anyone needing to notice and flip it, and without a cron job to do it —
// same non-invasive approach as EN_RETARD. Any other status (including an already-stored
// EXPIRE) passes through untouched.
export function deriveDevisStatus(status: DevisStatus, validUntil: string | Date | null, now: Date = new Date()): DevisStatus {
  if (status !== "ENVOYE" || !validUntil) return status
  return startOfUtcDay(now) > startOfUtcDay(new Date(validUntil)) ? "EXPIRE" : status
}

// Mirrors deriveDevisStatus at the query level, the same way factureStatusWhere mirrors
// deriveFactureStatus: EXPIRE can now come from two places (stored directly, or derived
// from an ENVOYE devis past its validUntil), and ENVOYE must exclude what would derive to
// EXPIRE — a plain `status` equality filter would miss/duplicate rows across pages.
export function devisStatusWhere(status: DevisStatus, now: Date = new Date()): Record<string, unknown> {
  const todayStart = new Date(startOfUtcDay(now))
  if (status === "EXPIRE") {
    return { OR: [{ status: "EXPIRE" }, { status: "ENVOYE", validUntil: { lt: todayStart } }] }
  }
  if (status === "ENVOYE") {
    return { status: "ENVOYE", OR: [{ validUntil: null }, { validUntil: { gte: todayStart } }] }
  }
  return { status }
}
