// src/lib/finance/income-statement.ts
import { prisma } from "@/lib/prisma/client"
import {
  INCOME_BUCKETS, EXPENSE_BUCKETS,
  type IncomeBucket, type ExpenseBucket, type ExerciceRef, type IncomeStatementPeriod,
} from "@/lib/finance/income-statement-shared"

export { INCOME_BUCKETS, EXPENSE_BUCKETS }
export type { IncomeBucket, ExpenseBucket, ExerciceRef, IncomeStatementPeriod }

// Legacy Don-sourced Income rows predate the Income.donId link (see schema.prisma) and are
// only recognizable by the description the webhook/encaissement routes have always written.
const LEGACY_DON_DESCRIPTION = /^Don( récurrent)? de /i

// Same reasoning as LEGACY_DON_DESCRIPTION, for Income rows a paid BoutiqueCommande posted
// before Income.commandeId existed — every boutique-sourced Income creation site (storefront
// checkout, manual encaissement, and the event/membership-signup-bundled purchase paths) has
// always written one of these prefixes (see webhook/stripe/route.ts,
// boutique/commandes/[id]/route.ts, lib/webhook/evenement-products.ts and
// lib/webhook/membership-form-products.ts).
const LEGACY_BOUTIQUE_DESCRIPTION = /^(Vente boutique|Frais de livraison)/i

// Same reasoning again, for Income rows a Cotisation payment posted before
// Income.cotisationPaymentId existed (confirmed against real historical data — see
// src/lib/cotisation-payments.ts for the description format this matches). Excludes the
// distinct "Cotisation {id} — payée en trop via Stripe" overpayment-safety-net wording
// (webhook/stripe/route.ts), which is deliberately never linked to a CotisationPayment and
// has no real bucket to fall back into other than "autres" — that row is a reconciliation
// flag for an admin, not a confirmed dues payment.
const LEGACY_COTISATION_DESCRIPTION = /^Cotisation \d{4} — /

// Best-effort match against FinanceCategory.name — categories are free text, seeded in French
// (see /api/finances/categories/seed) but renameable per association, so this only covers the
// default/common cases. Anything that doesn't match falls into "autres", never miscounted out
// of the total.
const INCOME_CATEGORY_PATTERNS: [RegExp, IncomeBucket][] = [
  [/cotisation|adh[ée]sion/i, "cotisations"],
  [/^dons?$|donation/i,       "dons"],
  [/subvention/i,             "subventions"],
  [/boutique|ventes?/i,       "boutique"],
  [/billetterie|[ée]v[ée]nement/i, "evenements"],
]

const EXPENSE_CATEGORY_PATTERNS: [RegExp, ExpenseBucket][] = [
  [/assuran/i,                     "assurance"],
  [/communicat/i,                  "communication"],
  [/mat[ée]riel/i,                 "materiel"],
  [/transport|d[ée]placement/i,    "transport"],
  [/frais bancaire|bancaire/i,     "fraisBancaires"],
  [/location|loyer|aluguel/i,      "location"],
  [/[ée]quipement/i,               "equipement"],
]

function emptyIncome(): Record<IncomeBucket, number> {
  return { cotisations: 0, dons: 0, subventions: 0, boutique: 0, evenements: 0, autres: 0 }
}

function emptyExpense(): Record<ExpenseBucket, number> {
  return { assurance: 0, communication: 0, materiel: 0, transport: 0, fraisBancaires: 0, location: 0, equipement: 0, autres: 0 }
}

type IncomeRow = {
  amount:              { toString(): string }
  description:         string | null
  cotisationPaymentId: string | null
  donId:               string | null
  commandeId:          string | null
  participationId:     string | null
  category:            { name: string } | null
}

export function classifyIncome(row: IncomeRow): IncomeBucket {
  if (row.cotisationPaymentId) return "cotisations"
  if (row.donId)                return "dons"
  if (row.commandeId)           return "boutique"
  if (row.participationId)      return "evenements"
  if (row.description && LEGACY_DON_DESCRIPTION.test(row.description)) return "dons"
  if (row.description && LEGACY_BOUTIQUE_DESCRIPTION.test(row.description)) return "boutique"
  if (row.description && LEGACY_COTISATION_DESCRIPTION.test(row.description)) return "cotisations"
  if (row.category) {
    const match = INCOME_CATEGORY_PATTERNS.find(([pattern]) => pattern.test(row.category!.name))
    if (match) return match[1]
  }
  return "autres"
}

type ExpenseRow = {
  category: { name: string } | null
}

export function classifyExpense(row: ExpenseRow): ExpenseBucket {
  if (row.category) {
    const match = EXPENSE_CATEGORY_PATTERNS.find(([pattern]) => pattern.test(row.category!.name))
    if (match) return match[1]
  }
  return "autres"
}

export async function computeIncomeStatementPeriod(
  associationId: string,
  exercice:      ExerciceRef | null,
): Promise<IncomeStatementPeriod> {
  if (!exercice) {
    return { exercice: null, income: emptyIncome(), expense: emptyExpense(), totalIncome: 0, totalExpense: 0, result: 0 }
  }

  const [incomeRows, expenseRows] = await Promise.all([
    prisma.income.findMany({
      where:  { associationId, exerciceId: exercice.id, status: "PAID" },
      select: { amount: true, description: true, cotisationPaymentId: true, donId: true, commandeId: true, participationId: true, category: { select: { name: true } } },
    }),
    prisma.expense.findMany({
      where:  { associationId, exerciceId: exercice.id, status: "VALIDATED" },
      select: { amount: true, category: { select: { name: true } } },
    }),
  ])

  const income = emptyIncome()
  for (const row of incomeRows) {
    income[classifyIncome(row)] += Number(row.amount)
  }

  const expense = emptyExpense()
  for (const row of expenseRows) {
    expense[classifyExpense(row)] += Number(row.amount)
  }

  const totalIncome  = INCOME_BUCKETS.reduce((sum, bucket) => sum + income[bucket], 0)
  const totalExpense = EXPENSE_BUCKETS.reduce((sum, bucket) => sum + expense[bucket], 0)

  return { exercice, income, expense, totalIncome, totalExpense, result: totalIncome - totalExpense }
}

// The exercice immediately preceding `current` on the association's fiscal calendar — the
// N-1 column. `all` must be sorted by startDate ascending (the /api/finances/exercices GET
// order — see useExercices()).
export function findPreviousExercice(all: ExerciceRef[], current: ExerciceRef): ExerciceRef | null {
  const index = all.findIndex(e => e.id === current.id)
  if (index <= 0) return null
  return all[index - 1]
}
