// src/lib/finance/default-categories.ts
// Single source of truth for the system/default FinanceCategory rows — one list consumed by
// the seed route (api/finances/categories/seed) to create them, and by the Compte de résultat
// calculation (src/lib/finance/income-statement.ts) as a hardcoded fallback when a given
// association deleted its own copy of a default category (the report must never break just
// because a key category went missing).
//
// accountingCode values are drawn from the controlled reference list in chart-of-accounts.ts
// (French PCG adapted for associations — www.anc.gouv.fr); every FinanceCategory, default or
// custom, must point at one of those codes (see financeCategorySchema). `key` is the stable
// identifier the report's buckets resolve against; it is never shown to the end user, only
// used internally and in exports.
import type { FinanceCategoryType, FinanceSection } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"

export interface DefaultFinanceCategory {
  key:            string
  name:           string
  type:           FinanceCategoryType
  accountingCode: string
  section:        FinanceSection
}

// accountingCode values match the controlled reference list in chart-of-accounts.ts (French
// PCG adapted for associations). `equipement`/`depreciationAmortization` sit in the
// IMMOBILISATION section — they're capital-asset/depreciation accounts (classe 2 / 68), never
// mixed into the exercice's operating result (see computeIncomeStatementPeriod/
// computeBudgetPeriod, which exclude that section from totalIncome/totalExpense/result).
export const DEFAULT_FINANCE_CATEGORIES: DefaultFinanceCategory[] = [
  // Receitas / Produits d'exploitation
  { key: "cotisations",                  name: "Cotisations sans contrepartie",                 type: "INCOME", accountingCode: "7561",  section: "OPERATING" },
  { key: "cotisationsAvecContrepartie",   name: "Cotisations avec contrepartie",                 type: "INCOME", accountingCode: "7562",  section: "OPERATING" },
  { key: "dons",                         name: "Dons",                                           type: "INCOME", accountingCode: "75411", section: "OPERATING" },
  { key: "mecenat",                      name: "Mécénat",                                        type: "INCOME", accountingCode: "7542",  section: "OPERATING" },
  { key: "patronageAvecContrepartie",     name: "Parrainage avec contrepartie publicitaire",     type: "INCOME", accountingCode: "7063",  section: "OPERATING" },
  { key: "evenements",                   name: "Événements / Billetterie",                      type: "INCOME", accountingCode: "706",   section: "OPERATING" },
  { key: "boutique",                     name: "Boutique",                                       type: "INCOME", accountingCode: "707",   section: "OPERATING" },
  { key: "subventions",                  name: "Subventions de fonctionnement",                 type: "INCOME", accountingCode: "741",   section: "OPERATING" },
  { key: "autresRecettes",               name: "Autres recettes",                                type: "INCOME", accountingCode: "758",   section: "OPERATING" },

  // Despesas / Charges d'exploitation
  { key: "eauEnergie",         name: "Eau et énergie",                               type: "EXPENSE", accountingCode: "6061", section: "OPERATING" },
  { key: "materielEntretien",  name: "Matériel d'entretien et petit équipement",     type: "EXPENSE", accountingCode: "6063", section: "OPERATING" },
  { key: "fournituresAdmin",   name: "Fournitures administratives",                  type: "EXPENSE", accountingCode: "6064", section: "OPERATING" },
  { key: "achatsMarchandises", name: "Marchandises achetées pour revente",           type: "EXPENSE", accountingCode: "607",  section: "OPERATING" },
  { key: "servicesExterieurs", name: "Prestations de services",                      type: "EXPENSE", accountingCode: "604",  section: "OPERATING" },
  { key: "location",           name: "Location de salles et immeubles",              type: "EXPENSE", accountingCode: "6132", section: "OPERATING" },
  { key: "locationMateriel",   name: "Location de matériel",                         type: "EXPENSE", accountingCode: "6135", section: "OPERATING" },
  { key: "maintenance",        name: "Entretien et réparations",                     type: "EXPENSE", accountingCode: "615",  section: "OPERATING" },
  { key: "assurance",          name: "Assurance",                                    type: "EXPENSE", accountingCode: "616",  section: "OPERATING" },
  { key: "commissionFormwise", name: "Commission Formwise",                          type: "EXPENSE", accountingCode: "6226", section: "OPERATING" },
  { key: "communication",      name: "Communication",                                type: "EXPENSE", accountingCode: "623",  section: "OPERATING" },
  { key: "transport",          name: "Déplacements",                                 type: "EXPENSE", accountingCode: "6251", section: "OPERATING" },
  { key: "telecom",            name: "Postes et télécommunications",                 type: "EXPENSE", accountingCode: "626",  section: "OPERATING" },
  { key: "fraisBancaires",     name: "Frais bancaires",                              type: "EXPENSE", accountingCode: "6278", section: "OPERATING" },
  { key: "cotisationsVersees", name: "Cotisations versées à d'autres organismes",    type: "EXPENSE", accountingCode: "6281", section: "OPERATING" },
  { key: "salaires",           name: "Salaires",                                     type: "EXPENSE", accountingCode: "641",  section: "OPERATING" },
  { key: "chargesSociales",    name: "Charges sociales",                             type: "EXPENSE", accountingCode: "645",  section: "OPERATING" },
  { key: "autresDepenses",     name: "Autres dépenses",                              type: "EXPENSE", accountingCode: "658",  section: "OPERATING" },

  // Imobilizado — informatif, hors résultat courant (voir doc comment ci-dessus)
  { key: "equipement",               name: "Équipement (immobilisation)",            type: "EXPENSE", accountingCode: "218300", section: "IMMOBILISATION" },
  { key: "depreciationAmortization", name: "Dépréciations / Amortissements",         type: "EXPENSE", accountingCode: "681",    section: "IMMOBILISATION" },
]

export function defaultCategoryByKey(key: string): DefaultFinanceCategory | undefined {
  return DEFAULT_FINANCE_CATEGORIES.find(c => c.key === key)
}

// Find-or-create, keyed on `key` — never touches a category the association already has (see
// the seed route's own reasoning). Shared by the manual "Initialiser les catégories par
// défaut" button (api/finances/categories/seed) and the Compte de résultat report itself: the
// report's own calculation already tolerates a missing default category via a virtual line
// (defaultCategoryByKey as metadata-only fallback), but the "à catégoriser" → categorize
// action needs a REAL FinanceCategory row with a real id to assign — a virtual line has no id
// to PATCH onto a transaction. Calling this before computing the report guarantees that picker
// is never empty just because a treasurer never visited Comptabilité > Catégories first.
export async function ensureDefaultFinanceCategories(associationId: string): Promise<number> {
  // archivedAt: null — an archived default category has its key freed by DELETE precisely so
  // it drops out of this check and a fresh active row gets created under the same key/name
  // (see that route's doc comment). Without this filter, an archived default would count as
  // "already has one", and ensureDefaultFinanceCategories/the report's "à catégoriser" picker
  // would never offer a real, active row for that bucket again.
  const existing = await prisma.financeCategory.findMany({
    where:  { associationId, key: { not: null }, archivedAt: null },
    select: { key: true },
  })
  const existingKeys = new Set(existing.map(c => c.key))

  const toCreate = DEFAULT_FINANCE_CATEGORIES.filter(c => !existingKeys.has(c.key))
  if (toCreate.length > 0) {
    await prisma.financeCategory.createMany({
      // skipDuplicates — an association can have a legacy, pre-Fase-1 category that already
      // owns the exact name a new default also wants (confirmed against real dev data: a
      // keyless "Salaires" already existed next to the new keyed "Salaires" default this adds).
      // Without this, that one name collision would make the WHOLE batch fail (createMany on
      // Postgres isn't atomic-per-row by default), silently blocking every OTHER default
      // category too. The one that collides is just skipped — see
      // scripts/backfill-finance-category-accounting-codes.ts's "legacy pre-Fase-1" bucket for
      // the actual remediation (archive the legacy row, which frees the name for this default
      // to be created on the next call).
      skipDuplicates: true,
      data: toCreate.map(c => ({ ...c, associationId, isDefault: true })),
    })
  }
  return toCreate.length
}
