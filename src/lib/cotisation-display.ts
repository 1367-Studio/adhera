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

// Where each échéance stands under the waterfall, in due-date order — what the "record a
// payment" modal needs to let a manager pick the échéance being paid now rather than typing
// the figure by hand. `remainingAmount` is what's still owed on that échéance alone (less than
// its amount when a previous payment only partly covered it); `amountToClear` is what has to be
// paid now to settle it, i.e. every earlier unpaid échéance too, since payments aren't linked
// to a specific échéance and always cover the oldest ones first.
export type InstallmentBalance<T extends DisplayInstallment> = T & {
  covered:         boolean
  position:        number
  remainingAmount: number
  amountToClear:   number
}

export function installmentBalances<T extends DisplayInstallment>(installments: T[], amountPaid: number): InstallmentBalance<T>[] {
  let cumulativeDue = 0
  return installmentCoverage(installments, amountPaid).map((installment, index) => {
    cumulativeDue += installment.amount
    const amountToClear   = Math.max(0, cumulativeDue - amountPaid)
    const remainingAmount = Math.min(installment.amount, amountToClear)
    return {
      ...installment,
      position:        index + 1,
      remainingAmount: installment.covered ? 0 : remainingAmount,
      amountToClear:   installment.covered ? 0 : amountToClear,
    }
  })
}
