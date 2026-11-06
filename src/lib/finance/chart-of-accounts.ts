// src/lib/finance/chart-of-accounts.ts
// Controlled list of accounting account numbers a FinanceCategory is allowed to point at —
// replaces free-text accountingCode entry. Based on the French PCG (plan comptable général)
// as adapted for associations (www.anc.gouv.fr). This is a base, not a complete chart of
// accounts — custom categories still choose from this same list, they just pick whichever
// reference account fits their real activity (e.g. Billetterie and Ateliers can both point
// at 706000, see FinanceCategoryForm's duplicate-code warning).
//
// Every code is stored and displayed in its full 6-digit PCG form (zero-padded on the right,
// e.g. "7561" -> "756100") so a short and a long spelling of the same account can never both
// exist as distinct entries — see normalizeAccountingCode.
import type { FinanceCategoryType, FinanceSection } from "@prisma/client"

export interface ReferenceAccount {
  code:    string
  label:   string
  type:    FinanceCategoryType
  // The FinanceSection a category pointing at this account belongs in — single source of
  // truth for sectionForAccountCode, so default-categories.ts and the create/edit form derive
  // section from the account instead of each hardcoding it independently (the two used to be
  // able to drift out of sync).
  section: FinanceSection
}

export const REFERENCE_ACCOUNTS: ReferenceAccount[] = [
  // Receitas / Produits
  { code: "756100", label: "Cotisations sans contrepartie",              type: "INCOME", section: "OPERATING" },
  { code: "756200", label: "Cotisations avec contrepartie",               type: "INCOME", section: "OPERATING" },
  { code: "754110", label: "Dons en numéraire",                           type: "INCOME", section: "OPERATING" },
  { code: "754200", label: "Mécénat",                                     type: "INCOME", section: "OPERATING" },
  { code: "706300", label: "Parrainage avec contrepartie publicitaire",   type: "INCOME", section: "OPERATING" },
  // 706100 is Formwise's own suggested subaccount to track ticketing separately; 706000 is the
  // broader "prestations de services" account Billetterie and Prestations facturées can both
  // fall back to (see default-categories.ts's evenements/factures entries).
  { code: "706100", label: "Prestations de services : billetterie",      type: "INCOME", section: "OPERATING" },
  { code: "706000", label: "Prestations de services",                    type: "INCOME", section: "OPERATING" },
  { code: "707000", label: "Ventes de marchandises (boutique)",          type: "INCOME", section: "OPERATING" },
  { code: "741000", label: "Subventions de fonctionnement",              type: "INCOME", section: "OPERATING" },
  { code: "758000", label: "Autres produits de gestion courante",        type: "INCOME", section: "OPERATING" },

  // Despesas / Charges
  { code: "606100", label: "Eau et énergie",                                      type: "EXPENSE", section: "OPERATING" },
  { code: "606300", label: "Matériel d'entretien et petit équipement",            type: "EXPENSE", section: "OPERATING" },
  { code: "606400", label: "Fournitures administratives",                         type: "EXPENSE", section: "OPERATING" },
  { code: "606800", label: "Autres matières et fournitures",                      type: "EXPENSE", section: "OPERATING" },
  { code: "607000", label: "Marchandises achetées pour revente",                  type: "EXPENSE", section: "OPERATING" },
  { code: "604000", label: "Achats d'études et prestations de services",          type: "EXPENSE", section: "OPERATING" },
  { code: "611000", label: "Sous-traitance générale",                            type: "EXPENSE", section: "OPERATING" },
  { code: "613200", label: "Location de salles et immeubles",                     type: "EXPENSE", section: "OPERATING" },
  { code: "613500", label: "Location de matériel",                                type: "EXPENSE", section: "OPERATING" },
  { code: "615000", label: "Entretien et réparations",                            type: "EXPENSE", section: "OPERATING" },
  { code: "616000", label: "Assurances",                                          type: "EXPENSE", section: "OPERATING" },
  // 622200 (Formwise's own platform commission) and 622600 (Honoraires) are distinct accounts
  // — do not conflate them (see default-categories.ts doc comment on the commissionFormwise fix).
  { code: "622200", label: "Commissions et courtages sur ventes",                 type: "EXPENSE", section: "OPERATING" },
  { code: "622600", label: "Honoraires",                                          type: "EXPENSE", section: "OPERATING" },
  { code: "623000", label: "Communication, publicité",                            type: "EXPENSE", section: "OPERATING" },
  { code: "624000", label: "Transports de biens et transports collectifs du personnel", type: "EXPENSE", section: "OPERATING" },
  { code: "625100", label: "Déplacements",                                        type: "EXPENSE", section: "OPERATING" },
  { code: "626000", label: "Postes et télécommunications",                        type: "EXPENSE", section: "OPERATING" },
  // 627000 is a real bank service fee (account maintenance, wire fees...); 627800 is reserved
  // for Stripe's own per-charge processing fee (see connect-stripe-fee.ts) — keep them separate,
  // never re-merge into one generic "bank fees" account.
  { code: "627000", label: "Services bancaires et assimilés",                     type: "EXPENSE", section: "OPERATING" },
  { code: "627800", label: "Autres frais et commissions sur prestations de services", type: "EXPENSE", section: "OPERATING" },
  { code: "628100", label: "Cotisations versées à d'autres organismes",           type: "EXPENSE", section: "OPERATING" },
  { code: "641000", label: "Salaires",                                           type: "EXPENSE", section: "OPERATING" },
  { code: "645000", label: "Charges sociales",                                   type: "EXPENSE", section: "OPERATING" },
  { code: "651100", label: "Redevances pour concessions, brevets, licences, marques, procédés, solutions informatiques", type: "EXPENSE", section: "OPERATING" },
  { code: "658000", label: "Autres charges de gestion courante",                 type: "EXPENSE", section: "OPERATING" },

  // Imobilizado (classe 2/6-8) — informatif seulement, voir FinanceSection.IMMOBILISATION
  { code: "218300", label: "Matériel de bureau et matériel informatique",        type: "EXPENSE", section: "IMMOBILISATION" },
  { code: "681000", label: "Dépréciations / Amortissements",                     type: "EXPENSE", section: "IMMOBILISATION" },
]

export function referenceAccountsForType(type: FinanceCategoryType): ReferenceAccount[] {
  return REFERENCE_ACCOUNTS.filter(a => a.type === type)
}

export function isValidAccountingCode(code: string, type: FinanceCategoryType): boolean {
  return REFERENCE_ACCOUNTS.some(a => a.code === code && a.type === type)
}

// Right-pads a PCG account number to its canonical 6-digit form ("7561" -> "756100", "604" ->
// "604000") so a legacy short spelling and today's full spelling of the same account are
// always recognized as identical — never two separate accountingCode values.
export function normalizeAccountingCode(code: string): string {
  const trimmed = code.trim()
  if (!/^\d{1,6}$/.test(trimmed)) return trimmed
  return trimmed.padEnd(6, "0")
}

// Section a category pointing at this account belongs in, or null when the code isn't in the
// controlled reference list (an old free-text/legacy code) — the form shows "Section à
// vérifier" in that case rather than guessing or silently defaulting to OPERATING.
export function sectionForAccountCode(code: string): FinanceSection | null {
  const normalized = normalizeAccountingCode(code)
  return REFERENCE_ACCOUNTS.find(a => a.code === normalized)?.section ?? null
}
