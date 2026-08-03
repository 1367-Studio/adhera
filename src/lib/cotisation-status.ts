import { EPSILON } from "@/lib/cotisation-payments"

export type CotisationStatus =
  | "EN_ATTENTE" | "PARTIELLEMENT_PAYEE" | "PAYE" | "EN_RETARD" | "EXONERE" | "ANNULEE"

// EXONERE/ANNULEE are the only statuses an admin can set by hand — once a cotisation is on
// one of them, deriveCotisationStatus below must never touch it again on its own, whether
// from a payment, an edit, or the daily cron sweep (src/app/api/cron/cotisation-status-sweep).
const MANUAL_STATUSES: readonly CotisationStatus[] = ["EXONERE", "ANNULEE"]

export type InstallmentInput = { amount: number; dueDate: Date; order: number }

// dueDate is stored at UTC midnight of a plain <input type=date> value. Comparing calendar
// days (not exact instants) avoids flipping a cotisation late 1-2h into its own due date for
// a France-based association (UTC+1/+2) — mirrors startOfUtcDay in src/lib/facture-status.ts.
function startOfUtcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

// Payments aren't linked to a specific installment (see prisma/schema.prisma — no
// installmentId on CotisationPayment) — they're fungible, so which installment is "covered"
// is derived fresh every time by walking the schedule in due-date order and consuming the
// running payments total against each installment's cumulative amount. Returns the
// cumulative amount due *through* that installment too, since callers need both (isLate only
// needs the installment's own dueDate; nextAmountDue needs the cumulative to know how much
// more is owed to fully cover it).
function firstUncoveredInstallment(installments: InstallmentInput[], paymentsTotal: number): { installment: InstallmentInput; cumulativeDue: number } | null {
  const sorted = [...installments].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime() || a.order - b.order)
  let cumulativeDue = 0
  for (const installment of sorted) {
    cumulativeDue += installment.amount
    if (paymentsTotal < cumulativeDue - EPSILON) return { installment, cumulativeDue }
  }
  return null
}

function isLate(amountPaid: number, dueDate: Date | null, installments: InstallmentInput[], now: Date): boolean {
  const today = startOfUtcDay(now)
  if (installments.length > 0) {
    const next = firstUncoveredInstallment(installments, amountPaid)
    return !!next && today > startOfUtcDay(next.installment.dueDate)
  }
  if (!dueDate) return false
  return today > startOfUtcDay(dueDate)
}

// How much is owed *right now* to fully catch up through the next unpaid installment — not
// necessarily the whole remaining balance. Used to size the online-checkout charge so a
// cotisation with a payment schedule can be paid off one installment at a time instead of
// always demanding the full remaining balance in one go (see /api/portal/cotisation/checkout).
// Without an installment schedule, "the next amount due" is just the full remaining balance,
// same as before this feature existed.
export function nextAmountDue(input: {
  amount:        number
  amountPaid:    number
  installments?: InstallmentInput[]
}): number {
  const remaining = input.amount - input.amountPaid
  if (remaining <= EPSILON) return 0
  if (!input.installments || input.installments.length === 0) return remaining
  const next = firstUncoveredInstallment(input.installments, input.amountPaid)
  // next is only null here if amountPaid already covers every installment, i.e. remaining
  // would have been <= EPSILON above — kept as a safe fallback rather than assumed unreachable.
  if (!next) return remaining
  return Math.min(remaining, next.cumulativeDue - input.amountPaid)
}

// Single source of truth for every automatic status transition (payment recorded/removed,
// cotisation create/edit, Stripe webhooks, the daily cron sweep) — priority order, highest
// first: EXONERE/ANNULEE (manual) > PAYE > EN_RETARD > PARTIELLEMENT_PAYEE > EN_ATTENTE.
export function deriveCotisationStatus(input: {
  currentStatus: CotisationStatus
  amount:        number
  amountPaid:    number
  dueDate:       Date | null
  installments?: InstallmentInput[]
  now?:          Date
}): CotisationStatus {
  if (MANUAL_STATUSES.includes(input.currentStatus)) return input.currentStatus
  if (input.amountPaid >= input.amount - EPSILON) return "PAYE"
  if (isLate(input.amountPaid, input.dueDate, input.installments ?? [], input.now ?? new Date())) return "EN_RETARD"
  if (input.amountPaid > EPSILON) return "PARTIELLEMENT_PAYEE"
  return "EN_ATTENTE"
}
