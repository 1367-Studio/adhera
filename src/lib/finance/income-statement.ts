// src/lib/finance/income-statement.ts
import { prisma } from "@/lib/prisma/client"
import { DEFAULT_FINANCE_CATEGORIES, defaultCategoryByKey } from "@/lib/finance/default-categories"
import {
  FINANCE_SECTIONS,
  type ExerciceRef, type IncomeStatementPeriod, type FinanceSectionKey,
  type CategoryLine, type SectionLines, type UncategorizedBucket, type TransactionDetail,
} from "@/lib/finance/income-statement-shared"

export type { ExerciceRef, IncomeStatementPeriod }

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
// (webhook/stripe/route.ts), which is deliberately never linked to a CotisationPayment —
// it has no reliable bucket to resolve to, so (like any other unmatched row) it correctly
// falls into "à catégoriser" rather than being guessed at.
const LEGACY_COTISATION_DESCRIPTION = /^Cotisation \d{4} — /

type CategoryRow = {
  id:             string
  key:            string | null
  name:           string
  accountingCode: string | null
  section:        FinanceSectionKey
  isDefault:      boolean
  type:           "INCOME" | "EXPENSE"
}

interface ResolvedCategory {
  categoryId:     string | null // null = virtual line (default category metadata, no live FinanceCategory row)
  key:            string | null
  name:           string
  accountingCode: string | null
  section:        FinanceSectionKey
  isDefault:      boolean
}

function toResolved(cat: CategoryRow): ResolvedCategory {
  return { categoryId: cat.id, key: cat.key, name: cat.name, accountingCode: cat.accountingCode, section: cat.section, isDefault: cat.isDefault }
}

// The origin ids are authoritative (set by the exact code path that created the row) — the
// description regexes only cover Income rows written before those ids existed. Order matters:
// an id match always wins over a text match.
function incomeOriginKey(row: { cotisationPaymentId: string | null; donId: string | null; commandeId: string | null; participationId: string | null; description: string | null }): string | null {
  if (row.cotisationPaymentId) return "cotisations"
  if (row.donId) return "dons"
  if (row.commandeId) return "boutique"
  if (row.participationId) return "evenements"
  if (row.description) {
    if (LEGACY_DON_DESCRIPTION.test(row.description)) return "dons"
    if (LEGACY_BOUTIQUE_DESCRIPTION.test(row.description)) return "boutique"
    if (LEGACY_COTISATION_DESCRIPTION.test(row.description)) return "cotisations"
  }
  return null
}

// Priority: an explicit categoryId (set by hand on the manual Income/Expense form, or by a
// treasurer resolving an "à catégoriser" row) always wins over anything derived automatically
// — that's the mechanism that makes a manual fix stick permanently without touching the row
// that created it. Only once there's no explicit categoryId do we fall back to origin ids,
// then legacy description regexes, then give up (null = "à catégoriser").
function resolveIncomeCategory(
  row: { categoryId: string | null; cotisationPaymentId: string | null; donId: string | null; commandeId: string | null; participationId: string | null; description: string | null },
  categoriesById: Map<string, CategoryRow>,
  categoriesByKey: Map<string, CategoryRow>,
): ResolvedCategory | null {
  if (row.categoryId) {
    const cat = categoriesById.get(row.categoryId)
    if (cat && cat.type === "INCOME") return toResolved(cat)
  }
  const originKey = incomeOriginKey(row)
  if (originKey) {
    const cat = categoriesByKey.get(originKey)
    if (cat) return toResolved(cat)
    const def = defaultCategoryByKey(originKey)
    if (def) return { categoryId: null, key: def.key, name: def.name, accountingCode: def.accountingCode, section: def.section, isDefault: true }
  }
  return null
}

// Expense has no equivalent of Income's origin ids (cotisationPaymentId, donId...) — a manual
// expense is only ever linked by an explicit categoryId. No category chosen → "à catégoriser",
// never guessed at by regex (there's no free-text signal reliable enough to guess from).
function resolveExpenseCategory(
  row: { categoryId: string | null },
  categoriesById: Map<string, CategoryRow>,
): ResolvedCategory | null {
  if (row.categoryId) {
    const cat = categoriesById.get(row.categoryId)
    if (cat && cat.type === "EXPENSE") return toResolved(cat)
  }
  return null
}

function incomeOrigin(row: { cotisationPaymentId: string | null; donId: string | null; commandeId: string | null; participationId: string | null; facturePaymentId: string | null }): string {
  if (row.cotisationPaymentId) return "Adhésion"
  if (row.donId) return "Don"
  if (row.commandeId) return "Boutique"
  if (row.participationId) return "Événement"
  if (row.facturePaymentId) return "Facture"
  return "Saisie manuelle"
}

function incomePersonName(row: {
  membre:       { firstName: string; lastName: string } | null
  don:          { firstName: string; lastName: string } | null
  commande:     { guestName: string | null; membre: { firstName: string; lastName: string } | null } | null
  participation: { firstName: string; lastName: string } | null
}): string | null {
  if (row.membre) return `${row.membre.firstName} ${row.membre.lastName}`.trim()
  if (row.don) return `${row.don.firstName} ${row.don.lastName}`.trim()
  if (row.commande) {
    if (row.commande.membre) return `${row.commande.membre.firstName} ${row.commande.membre.lastName}`.trim()
    if (row.commande.guestName) return row.commande.guestName
  }
  if (row.participation) return `${row.participation.firstName} ${row.participation.lastName}`.trim()
  return null
}

function emptySections(): Record<FinanceSectionKey, SectionLines> {
  const sections = {} as Record<FinanceSectionKey, SectionLines>
  for (const section of FINANCE_SECTIONS) sections[section] = { income: [], expense: [] }
  return sections
}

function emptyUncategorized(): UncategorizedBucket {
  return { amount: 0, count: 0, transactions: [] }
}

function emptyPeriod(exercice: ExerciceRef | null): IncomeStatementPeriod {
  return {
    exercice,
    sections: emptySections(),
    uncategorizedIncome: emptyUncategorized(),
    uncategorizedExpense: emptyUncategorized(),
    totalIncome: 0,
    totalExpense: 0,
    resultOperational: 0,
    result: 0,
  }
}

export async function computeIncomeStatementPeriod(
  associationId: string,
  exercice:      ExerciceRef | null,
): Promise<IncomeStatementPeriod> {
  if (!exercice) return emptyPeriod(null)

  const [categories, incomeRows, expenseRows] = await Promise.all([
    prisma.financeCategory.findMany({
      where:  { associationId },
      select: { id: true, key: true, name: true, accountingCode: true, section: true, isDefault: true, type: true },
    }),
    prisma.income.findMany({
      where:  { associationId, exerciceId: exercice.id, status: "PAID" },
      select: {
        id: true, amount: true, date: true, description: true, paymentMethod: true, reference: true,
        categoryId: true, cotisationPaymentId: true, donId: true, commandeId: true, participationId: true, facturePaymentId: true,
        membre:        { select: { firstName: true, lastName: true } },
        don:           { select: { firstName: true, lastName: true } },
        commande:      { select: { guestName: true, membre: { select: { firstName: true, lastName: true } } } },
        participation: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.expense.findMany({
      where:  { associationId, exerciceId: exercice.id, status: "VALIDATED" },
      select: { id: true, amount: true, date: true, description: true, vendor: true, paymentMethod: true, reference: true, categoryId: true, factureRecueId: true },
    }),
  ])

  const categoriesById  = new Map(categories.map(c => [c.id, c as CategoryRow]))
  const categoriesByKey = new Map(categories.filter(c => c.key).map(c => [c.key as string, c as CategoryRow]))

  const period = emptyPeriod(exercice)
  const lineByKey = new Map<string, CategoryLine>()

  function getOrCreateLine(resolved: ResolvedCategory, type: "income" | "expense"): CategoryLine {
    const mapKey = resolved.categoryId ? `id:${resolved.categoryId}` : `virtual:${resolved.key}`
    let line = lineByKey.get(mapKey)
    if (!line) {
      line = { categoryId: resolved.categoryId, key: resolved.key, name: resolved.name, accountingCode: resolved.accountingCode, isDefault: resolved.isDefault, amount: 0, transactions: [] }
      lineByKey.set(mapKey, line)
      period.sections[resolved.section][type].push(line)
    }
    return line
  }

  // Default categories always appear as a line, even with zero activity, in the SAME fixed
  // order every time — a statutory report reads the same shape year over year (see
  // income-statement-shared.ts). Iterating DEFAULT_FINANCE_CATEGORIES itself (not the `categories`
  // array as fetched from the DB) is what guarantees that order: `financeCategory.findMany` has
  // no `orderBy` here, so relying on DB row order would make the row sequence effectively random
  // once `ensureDefaultFinanceCategories` has created real rows for every association. For each
  // default, use the association's real row when it has one (so `categoryId`/drill-down work),
  // falling back to virtual metadata only for a default the association deleted.
  //
  // Legacy `isDefault: true` rows with no `key` (from the pre-Fase-1 seed — "Ventes", "Paiements
  // Stripe"...) are deliberately NOT forced onto the report as permanent zero rows: they aren't
  // part of DEFAULT_FINANCE_CATEGORIES's structured set and would just clutter every period with
  // legacy noise. They still work exactly like any custom category: shown (and counted) the
  // moment a transaction is actually linked to them, via the custom-category path below.
  for (const def of DEFAULT_FINANCE_CATEGORIES) {
    const cat = categoriesByKey.get(def.key)
    const resolved: ResolvedCategory = cat
      ? toResolved(cat)
      : { categoryId: null, key: def.key, name: def.name, accountingCode: def.accountingCode, section: def.section, isDefault: true }
    getOrCreateLine(resolved, def.type === "INCOME" ? "income" : "expense")
  }

  for (const row of incomeRows) {
    const amount = Number(row.amount)
    const detail: TransactionDetail = {
      id: row.id, type: "INCOME", date: row.date.toISOString(), amount,
      paymentMethod: row.paymentMethod, origin: incomeOrigin(row), personName: incomePersonName(row), reference: row.reference,
      description: row.description,
    }
    const resolved = resolveIncomeCategory(row, categoriesById, categoriesByKey)
    if (!resolved) {
      period.uncategorizedIncome.amount += amount
      period.uncategorizedIncome.count += 1
      period.uncategorizedIncome.transactions.push(detail)
      continue
    }
    const line = getOrCreateLine(resolved, "income")
    line.amount += amount
    line.transactions.push(detail)
  }

  for (const row of expenseRows) {
    const amount = Number(row.amount)
    const detail: TransactionDetail = {
      id: row.id, type: "EXPENSE", date: row.date.toISOString(), amount,
      paymentMethod: row.paymentMethod, origin: row.factureRecueId ? "Facture fournisseur" : "Saisie manuelle", personName: row.vendor, reference: row.reference,
      description: row.description,
    }
    const resolved = resolveExpenseCategory(row, categoriesById)
    if (!resolved) {
      period.uncategorizedExpense.amount += amount
      period.uncategorizedExpense.count += 1
      period.uncategorizedExpense.transactions.push(detail)
      continue
    }
    const line = getOrCreateLine(resolved, "expense")
    line.amount += amount
    line.transactions.push(detail)
  }

  let totalIncome = period.uncategorizedIncome.amount
  let totalExpense = period.uncategorizedExpense.amount
  for (const section of FINANCE_SECTIONS) {
    const sectionIncome  = period.sections[section].income.reduce((sum, l) => sum + l.amount, 0)
    const sectionExpense = period.sections[section].expense.reduce((sum, l) => sum + l.amount, 0)
    totalIncome  += sectionIncome
    totalExpense += sectionExpense
    if (section === "OPERATING") period.resultOperational = sectionIncome - sectionExpense
  }

  period.totalIncome  = totalIncome
  period.totalExpense = totalExpense
  period.result       = totalIncome - totalExpense

  return period
}

// Custom category lines are only created lazily (in computeIncomeStatementPeriod) when a
// transaction actually resolves to them — current and previous are computed independently, so
// a custom category with activity in only one of the two periods ends up with a line on that
// side and no matching (zero) line on the other. Without this, a current/previous pair of
// columns can't be rendered side by side: the UI would have no row to put the other period's
// value next to. Default category lines never need this — computeIncomeStatementPeriod always
// creates them on both sides already.
export function reconcileCustomCategoryLines(a: IncomeStatementPeriod, b: IncomeStatementPeriod): void {
  if (!a.exercice || !b.exercice) return
  for (const section of FINANCE_SECTIONS) {
    for (const type of ["income", "expense"] as const) {
      const aLines = a.sections[section][type]
      const bLines = b.sections[section][type]
      const aIds = new Set(aLines.map(l => l.categoryId).filter((id): id is string => id !== null))
      const bIds = new Set(bLines.map(l => l.categoryId).filter((id): id is string => id !== null))
      for (const line of bLines) {
        if (line.categoryId && !line.isDefault && !aIds.has(line.categoryId)) {
          aLines.push({ categoryId: line.categoryId, key: line.key, name: line.name, accountingCode: line.accountingCode, isDefault: false, amount: 0, transactions: [] })
        }
      }
      for (const line of aLines) {
        if (line.categoryId && !line.isDefault && !bIds.has(line.categoryId)) {
          bLines.push({ categoryId: line.categoryId, key: line.key, name: line.name, accountingCode: line.accountingCode, isDefault: false, amount: 0, transactions: [] })
        }
      }
    }
  }
}

// The exercice immediately preceding `current` on the association's fiscal calendar — the
// N-1 column. `all` must be sorted by startDate ascending (the /api/finances/exercices GET
// order — see useExercices()).
export function findPreviousExercice(all: ExerciceRef[], current: ExerciceRef): ExerciceRef | null {
  const index = all.findIndex(e => e.id === current.id)
  if (index <= 0) return null
  return all[index - 1]
}
