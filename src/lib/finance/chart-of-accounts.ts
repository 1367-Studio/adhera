// src/lib/finance/chart-of-accounts.ts
// Controlled list of accounting account numbers a FinanceCategory is allowed to point at —
// replaces free-text accountingCode entry. Based on the French PCG (plan comptable général)
// as adapted for associations (www.anc.gouv.fr). This is a base, not a complete chart of
// accounts — custom categories still choose from this same list, they just pick whichever
// reference account fits their real activity (e.g. Billetterie and Ateliers can both point
// at 706, see FinanceCategoryForm's duplicate-code warning).
import type { FinanceCategoryType } from "@prisma/client"

export interface ReferenceAccount {
  code:  string
  label: string
  type:  FinanceCategoryType
}

export const REFERENCE_ACCOUNTS: ReferenceAccount[] = [
  // Receitas / Produits
  { code: "7561",  label: "Cotisations sans contrepartie",              type: "INCOME" },
  { code: "7562",  label: "Cotisations avec contrepartie",               type: "INCOME" },
  { code: "75411", label: "Dons en numéraire",                           type: "INCOME" },
  { code: "7542",  label: "Mécénat",                                     type: "INCOME" },
  { code: "7063",  label: "Parrainage avec contrepartie publicitaire",   type: "INCOME" },
  { code: "706",   label: "Billetterie, prestations de services",       type: "INCOME" },
  { code: "707",   label: "Ventes de marchandises (boutique)",          type: "INCOME" },
  { code: "741",   label: "Subventions de fonctionnement",              type: "INCOME" },
  { code: "758",   label: "Autres produits de gestion courante",        type: "INCOME" },

  // Despesas / Charges
  { code: "6061",  label: "Eau et énergie",                                      type: "EXPENSE" },
  { code: "6063",  label: "Matériel d'entretien et petit équipement",            type: "EXPENSE" },
  { code: "6064",  label: "Fournitures administratives",                         type: "EXPENSE" },
  { code: "607",   label: "Marchandises achetées pour revente",                  type: "EXPENSE" },
  { code: "604",   label: "Prestations de services (achats)",                    type: "EXPENSE" },
  { code: "6132",  label: "Location de salles et immeubles",                     type: "EXPENSE" },
  { code: "6135",  label: "Location de matériel",                                type: "EXPENSE" },
  { code: "615",   label: "Entretien et réparations",                            type: "EXPENSE" },
  { code: "616",   label: "Assurances",                                          type: "EXPENSE" },
  { code: "6226",  label: "Honoraires",                                          type: "EXPENSE" },
  { code: "623",   label: "Communication, publicité",                            type: "EXPENSE" },
  { code: "6251",  label: "Déplacements",                                        type: "EXPENSE" },
  { code: "626",   label: "Postes et télécommunications",                        type: "EXPENSE" },
  { code: "6278",  label: "Autres frais et commissions bancaires",                type: "EXPENSE" },
  { code: "6281",  label: "Cotisations versées à d'autres organismes",           type: "EXPENSE" },
  { code: "641",   label: "Salaires",                                           type: "EXPENSE" },
  { code: "645",   label: "Charges sociales",                                   type: "EXPENSE" },
  { code: "658",   label: "Autres charges de gestion courante",                 type: "EXPENSE" },

  // Imobilizado (classe 2) — informatif seulement, voir FinanceSection.IMMOBILISATION
  { code: "218300", label: "Équipement (immobilisation)",                 type: "EXPENSE" },
  { code: "681",    label: "Dépréciations / Amortissements",              type: "EXPENSE" },
]

export function referenceAccountsForType(type: FinanceCategoryType): ReferenceAccount[] {
  return REFERENCE_ACCOUNTS.filter(a => a.type === type)
}

export function isValidAccountingCode(code: string, type: FinanceCategoryType): boolean {
  return REFERENCE_ACCOUNTS.some(a => a.code === code && a.type === type)
}
