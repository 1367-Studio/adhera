export type FactureStatus = "BROUILLON" | "EN_ATTENTE" | "PARTIELLEMENT_PAYEE" | "PAYEE" | "EN_RETARD" | "ANNULEE"

const EPSILON = 0.01

// dueDate is stored at UTC midnight of the chosen calendar day (it comes from a plain
// <input type=date>). Comparing it to `now` as exact instants — as this used to do — flips
// a facture to "En retard" the moment UTC midnight passes, i.e. 1-2am *on* its own due date
// for a France-based association (UTC+1/+2): it reads as late almost the entire day it's
// actually due, not after the day has passed. Comparing calendar days instead (both in UTC,
// matching how the date was stored) means it only flips the day *after* the due date.
function startOfUtcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

// EN_RETARD is never written to the DB — it's derived at read time from dueDate vs now
// for facturas still awaiting payment, so a late payment doesn't need a separate "un-mark
// as overdue" step and no cron job is needed to keep it in sync.
export function deriveFactureStatus(status: FactureStatus, dueDate: string | Date | null, now: Date = new Date()): FactureStatus {
  if (status !== "EN_ATTENTE" && status !== "PARTIELLEMENT_PAYEE") return status
  if (!dueDate) return status
  return startOfUtcDay(now) > startOfUtcDay(new Date(dueDate)) ? "EN_RETARD" : status
}

// Mirrors deriveFactureStatus at the query level: EN_RETARD is never stored, so filtering a
// list by it (or by EN_ATTENTE/PARTIELLEMENT_PAYEE, which must *exclude* what would derive
// to EN_RETARD) needs the same dueDate-vs-today logic in the `where` clause instead of a
// plain `status` equality — otherwise pagination is built from the wrong rows entirely
// (see the GET handler in app/api/factures/route.ts).
export function factureStatusWhere(status: FactureStatus, now: Date = new Date()): Record<string, unknown> {
  const todayStart = new Date(startOfUtcDay(now))
  if (status === "EN_RETARD") {
    return { status: { in: ["EN_ATTENTE", "PARTIELLEMENT_PAYEE"] }, dueDate: { lt: todayStart } }
  }
  if (status === "EN_ATTENTE" || status === "PARTIELLEMENT_PAYEE") {
    return { status, OR: [{ dueDate: null }, { dueDate: { gte: todayStart } }] }
  }
  return { status }
}

// PAYEE / PARTIELLEMENT_PAYEE aren't manual states — they're consequences of amountPaid vs
// total, the same way the paiements endpoints set them when a payment is added or removed.
// Trusting an arbitrary client-sent value for these two would let the badge lie about
// whether the balance is actually settled — e.g. bumping the total via an item edit while
// status stays "Payée" with the old amountPaid, or hand-picking "Payée" on a facture nobody
// ever paid. BROUILLON/EN_ATTENTE/ANNULEE are still fully manual and pass through untouched.
export function resolveManualStatus(status: FactureStatus, amountPaid: number, total: number): FactureStatus {
  if (status !== "PAYEE" && status !== "PARTIELLEMENT_PAYEE") return status
  if (amountPaid <= EPSILON) return "EN_ATTENTE"
  return amountPaid >= total - EPSILON ? "PAYEE" : "PARTIELLEMENT_PAYEE"
}
