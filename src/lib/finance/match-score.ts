type TxCandidate = {
  amount:      { toNumber?: () => number } | number
  date:        Date
  description?: string | null
  reference?:  string | null
  membre?:     { firstName: string; lastName: string } | null
}

type TxSource = {
  amount:          { toNumber?: () => number } | number
  transactionDate: Date
  label:           string
}

function toNum(v: { toNumber?: () => number } | number): number {
  if (typeof v === "number") return v
  return typeof v.toNumber === "function" ? v.toNumber() : Number(v)
}

function daysDiff(a: Date, b: Date): number {
  return Math.abs((a.getTime() - b.getTime()) / 86_400_000)
}

export function computeMatchScore(tx: TxSource, candidate: TxCandidate): number {
  let score = 0

  if (Math.abs(toNum(tx.amount) - toNum(candidate.amount)) < 0.01) score += 50

  if (daysDiff(tx.transactionDate, candidate.date) <= 3) score += 20

  const label = tx.label.toLowerCase()

  if (candidate.membre) {
    const last  = candidate.membre.lastName.toLowerCase()
    const first = candidate.membre.firstName.toLowerCase()
    if (label.includes(last) || label.includes(first)) score += 20
  }

  if (candidate.reference) {
    const ref = candidate.reference.toLowerCase()
    if (ref.length >= 3 && label.includes(ref)) score += 30
  }

  return score
}
