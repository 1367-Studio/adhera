// Pure, client-safe display helpers for cotisation installments — no server-only imports
// (unlike src/lib/cotisation-status.ts, which pulls in cotisation-payments.ts → Prisma/mail
// and can't be imported from a "use client" component). Mirrors that file's waterfall logic
// for display purposes; the server remains the sole authority on what's actually charged.

const EPSILON = 0.01

export type DisplayInstallment = { id?: string; amount: number; dueDate: string | Date }

// Which échéances look covered by payments received so far, in due-date order.
export function installmentCoverage<T extends DisplayInstallment>(installments: T[], amountPaid: number): (T & { covered: boolean })[] {
  const sorted = [...installments].sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime())
  let cumulative = 0
  return sorted.map(i => {
    cumulative += i.amount
    return { ...i, covered: amountPaid >= cumulative - EPSILON }
  })
}

// How much is owed right now to catch up through the next unpaid échéance — mirrors
// nextAmountDue in src/lib/cotisation-status.ts. Used client-side only to suggest a sensible
// default amount (e.g. pre-filling "record a payment"); the server always recomputes and
// enforces the real figure independently.
export function clientNextAmountDue(amount: number, amountPaid: number, installments: DisplayInstallment[]): number {
  const remaining = amount - amountPaid
  if (remaining <= EPSILON) return 0
  if (installments.length === 0) return remaining
  const withCoverage = installmentCoverage(installments, amountPaid)
  const firstUncovered = withCoverage.find(i => !i.covered)
  if (!firstUncovered) return remaining
  const cumulativeThroughIt = withCoverage
    .slice(0, withCoverage.indexOf(firstUncovered) + 1)
    .reduce((sum, i) => sum + i.amount, 0)
  return Math.min(remaining, cumulativeThroughIt - amountPaid)
}
