// src/lib/finance/default-categories.ts
// Single source of truth for the system/default FinanceCategory rows — one list consumed by
// the seed route (api/finances/categories/seed) to create them, and by the Compte de résultat
// calculation (src/lib/finance/income-statement.ts) as a hardcoded fallback when a given
// association deleted its own copy of a default category (the report must never break just
// because a key category went missing).
//
// accountingCode/section values match the reference Compte de résultat document (Association
// ROS1 export) — every default category sits in the OPERATING section today, same as that
// reference. `key` is the stable identifier the report's buckets resolve against; it is never
// shown to the end user, only used internally and in exports.
import type { FinanceCategoryType, FinanceSection } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"

export interface DefaultFinanceCategory {
  key:            string
  name:           string
  type:           FinanceCategoryType
  accountingCode: string
  section:        FinanceSection
}

export const DEFAULT_FINANCE_CATEGORIES: DefaultFinanceCategory[] = [
  // Receitas / Produits d'exploitation
  { key: "cotisations", name: "Cotisations / Adhésions", type: "INCOME", accountingCode: "756000", section: "OPERATING" },
  { key: "dons",         name: "Dons",                    type: "INCOME", accountingCode: "754000", section: "OPERATING" },
  { key: "subventions",  name: "Subventions",              type: "INCOME", accountingCode: "740000", section: "OPERATING" },
  { key: "boutique",     name: "Boutique",                 type: "INCOME", accountingCode: "708100", section: "OPERATING" },
  { key: "evenements",   name: "Événements",               type: "INCOME", accountingCode: "706100", section: "OPERATING" },
  { key: "autresRecettes", name: "Autres recettes",        type: "INCOME", accountingCode: "758000", section: "OPERATING" },

  // Despesas / Charges d'exploitation
  { key: "assurance",      name: "Assurance",                        type: "EXPENSE", accountingCode: "616000", section: "OPERATING" },
  { key: "communication",  name: "Communication",                    type: "EXPENSE", accountingCode: "623000", section: "OPERATING" },
  { key: "materiel",       name: "Matériel / Fournitures",           type: "EXPENSE", accountingCode: "606000", section: "OPERATING" },
  { key: "transport",      name: "Déplacements",                     type: "EXPENSE", accountingCode: "625000", section: "OPERATING" },
  { key: "fraisBancaires", name: "Frais bancaires",                  type: "EXPENSE", accountingCode: "627000", section: "OPERATING" },
  { key: "location",       name: "Location",                         type: "EXPENSE", accountingCode: "613000", section: "OPERATING" },
  { key: "equipement",     name: "Équipement",                       type: "EXPENSE", accountingCode: "218300", section: "OPERATING" },
  { key: "depreciationAmortization", name: "Dépréciations / Amortissements", type: "EXPENSE", accountingCode: "681100", section: "OPERATING" },
  { key: "autresDepenses", name: "Autres dépenses",                  type: "EXPENSE", accountingCode: "658000", section: "OPERATING" },
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
  const existing = await prisma.financeCategory.findMany({
    where:  { associationId, key: { not: null } },
    select: { key: true },
  })
  const existingKeys = new Set(existing.map(c => c.key))

  const toCreate = DEFAULT_FINANCE_CATEGORIES.filter(c => !existingKeys.has(c.key))
  if (toCreate.length > 0) {
    await prisma.financeCategory.createMany({
      data: toCreate.map(c => ({ ...c, associationId, isDefault: true })),
    })
  }
  return toCreate.length
}
