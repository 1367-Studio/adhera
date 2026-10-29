// src/lib/finance/category-resolution.ts
// Shared category-resolution logic for Income/Expense rows — used by BOTH the Compte de
// résultat (income-statement.ts) and the Orçamento previsto (budget.ts) computations so the
// two reports always agree on what counts as "à catégoriser". Before this module existed,
// budget.ts aggregated via a plain `groupBy` on the literal categoryId column while
// income-statement.ts additionally inferred a category from origin ids/legacy description —
// a row the Compte de résultat resolved correctly could show up as uncategorized on the
// Orçamento screen. See the FORM category-standardization plan for the full rationale.
import { defaultCategoryByKey } from "@/lib/finance/default-categories"
import type { FinanceSectionKey } from "@/lib/finance/income-statement-shared"

// Legacy Don-sourced Income rows predate the Income.donId link (see schema.prisma) and are
// only recognizable by the description the webhook/encaissement routes have always written.
export const LEGACY_DON_DESCRIPTION = /^Don( récurrent)? de /i

// Same reasoning as LEGACY_DON_DESCRIPTION, for Income rows a paid BoutiqueCommande posted
// before Income.commandeId existed — every boutique-sourced Income creation site (storefront
// checkout, manual encaissement, and the event/membership-signup-bundled purchase paths) has
// always written one of these prefixes (see webhook/stripe/route.ts,
// boutique/commandes/[id]/route.ts, lib/webhook/evenement-products.ts and
// lib/webhook/membership-form-products.ts).
export const LEGACY_BOUTIQUE_DESCRIPTION = /^(Vente boutique|Frais de livraison)/i

// Same reasoning again, for Income rows a Cotisation payment posted before
// Income.cotisationPaymentId existed (confirmed against real historical data — see
// src/lib/cotisation-payments.ts for the description format this matches). Excludes the
// distinct "Cotisation {id} — payée en trop via Stripe" overpayment-safety-net wording
// (webhook/stripe/route.ts), which is deliberately never linked to a CotisationPayment —
// it has no reliable bucket to resolve to, so (like any other unmatched row) it correctly
// falls into "à catégoriser" rather than being guessed at.
export const LEGACY_COTISATION_DESCRIPTION = /^Cotisation \d{4} — /

export type CategoryRow = {
  id:             string
  key:            string | null
  name:           string
  accountingCode: string | null
  section:        FinanceSectionKey
  isDefault:      boolean
  type:           "INCOME" | "EXPENSE"
}

export interface ResolvedCategory {
  categoryId:     string | null // null = virtual line (default category metadata, no live FinanceCategory row)
  key:            string | null
  name:           string
  accountingCode: string | null
  section:        FinanceSectionKey
  isDefault:      boolean
}

export function toResolved(cat: CategoryRow): ResolvedCategory {
  return { categoryId: cat.id, key: cat.key, name: cat.name, accountingCode: cat.accountingCode, section: cat.section, isDefault: cat.isDefault }
}

// The origin ids are authoritative (set by the exact code path that created the row) — the
// description regexes only cover Income rows written before those ids existed. Order matters:
// an id match always wins over a text match.
export function incomeOriginKey(row: { cotisationPaymentId: string | null; donId: string | null; commandeId: string | null; participationId: string | null; description: string | null }): string | null {
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

// Priority: an explicit categoryId (set by hand on the manual Income/Expense form, by the
// creation-time auto-classification — see resolve-default-category.ts — or by a treasurer
// resolving an "à catégoriser" row) always wins over anything derived automatically — that's
// the mechanism that makes a manual fix stick permanently without touching the row that
// created it. Only once there's no explicit categoryId do we fall back to origin ids, then
// legacy description regexes, then give up (null = "à catégoriser").
export function resolveIncomeCategory(
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
export function resolveExpenseCategory(
  row: { categoryId: string | null },
  categoriesById: Map<string, CategoryRow>,
): ResolvedCategory | null {
  if (row.categoryId) {
    const cat = categoriesById.get(row.categoryId)
    if (cat && cat.type === "EXPENSE") return toResolved(cat)
  }
  return null
}
