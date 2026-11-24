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
import type { FinanceCategoryType, FinanceSection, ChartAccountNature, NormalBalanceSide } from "@prisma/client"

export interface ReferenceAccount {
  code:    string
  label:   string
  type:    FinanceCategoryType
  // The FinanceSection a category pointing at this account belongs in — single source of
  // truth for sectionForAccountCode, so default-categories.ts and the create/edit form derive
  // section from the account instead of each hardcoding it independently (the two used to be
  // able to drift out of sync).
  section: FinanceSection
  // Real double-entry nature/normal side of this PCG account — single source of truth for
  // chart-accounts-seed.ts (FORM-107), so the real ledger (ChartAccount) and this reference/
  // label list never drift out of sync on what an account fundamentally IS. Note this can
  // differ from what `type`/`section` would naively suggest: 218300 is `type: "EXPENSE"`
  // (a FinanceCategory classifies the purchase as an outflow) but its true ledger nature is
  // ACTIF — it's a capitalized asset, not a charge.
  nature:     ChartAccountNature
  normalSide: NormalBalanceSide
}

export const REFERENCE_ACCOUNTS: ReferenceAccount[] = [
  // Receitas / Produits
  { code: "756100", label: "Cotisations sans contrepartie",              type: "INCOME", section: "OPERATING", nature: "PRODUIT", normalSide: "CREDIT" },
  { code: "756200", label: "Cotisations avec contrepartie",               type: "INCOME", section: "OPERATING", nature: "PRODUIT", normalSide: "CREDIT" },
  { code: "754110", label: "Dons manuels",                                type: "INCOME", section: "OPERATING", nature: "PRODUIT", normalSide: "CREDIT" },
  { code: "754200", label: "Mécénats",                                    type: "INCOME", section: "OPERATING", nature: "PRODUIT", normalSide: "CREDIT" },
  { code: "706300", label: "Parrainages",                                 type: "INCOME", section: "OPERATING", nature: "PRODUIT", normalSide: "CREDIT" },
  // 706100 is Formwise's own suggested subaccount to track ticketing separately; 706000 is the
  // broader "prestations de services" account Billetterie and Prestations facturées can both
  // fall back to (see default-categories.ts's evenements/factures entries).
  { code: "706100", label: "Prestations de services : billetterie",      type: "INCOME", section: "OPERATING", nature: "PRODUIT", normalSide: "CREDIT" },
  { code: "706000", label: "Ventes de prestations de services",          type: "INCOME", section: "OPERATING", nature: "PRODUIT", normalSide: "CREDIT" },
  { code: "707000", label: "Ventes de marchandises",                     type: "INCOME", section: "OPERATING", nature: "PRODUIT", normalSide: "CREDIT" },
  // Swapped with default-categories.ts's "subventions" display name (was mistakenly reversed:
  // the official PCG label and the display name had traded places) — this IS the account's
  // real intitulé comptable, "Subventions de fonctionnement" is just the category's name.
  { code: "741000", label: "Subventions d'exploitation",                 type: "INCOME", section: "OPERATING", nature: "PRODUIT", normalSide: "CREDIT" },
  { code: "758000", label: "Indemnités et autres produits",               type: "INCOME", section: "OPERATING", nature: "PRODUIT", normalSide: "CREDIT" },

  // Despesas / Charges
  { code: "606100", label: "Fournitures non stockables : eau, énergie",          type: "EXPENSE", section: "OPERATING", nature: "CHARGE", normalSide: "DEBIT" },
  { code: "606300", label: "Fournitures d'entretien et de petit équipement",     type: "EXPENSE", section: "OPERATING", nature: "CHARGE", normalSide: "DEBIT" },
  { code: "606400", label: "Fournitures administratives",                       type: "EXPENSE", section: "OPERATING", nature: "CHARGE", normalSide: "DEBIT" },
  { code: "606800", label: "Autres matières et fournitures",                    type: "EXPENSE", section: "OPERATING", nature: "CHARGE", normalSide: "DEBIT" },
  { code: "607000", label: "Achats de marchandises",                           type: "EXPENSE", section: "OPERATING", nature: "CHARGE", normalSide: "DEBIT" },
  { code: "604000", label: "Achats d'études et prestations de services",       type: "EXPENSE", section: "OPERATING", nature: "CHARGE", normalSide: "DEBIT" },
  { code: "611000", label: "Sous-traitance générale",                          type: "EXPENSE", section: "OPERATING", nature: "CHARGE", normalSide: "DEBIT" },
  { code: "613200", label: "Locations immobilières",                           type: "EXPENSE", section: "OPERATING", nature: "CHARGE", normalSide: "DEBIT" },
  { code: "613500", label: "Locations mobilières",                             type: "EXPENSE", section: "OPERATING", nature: "CHARGE", normalSide: "DEBIT" },
  { code: "615000", label: "Entretien et réparation",                          type: "EXPENSE", section: "OPERATING", nature: "CHARGE", normalSide: "DEBIT" },
  { code: "616000", label: "Primes d'assurances",                              type: "EXPENSE", section: "OPERATING", nature: "CHARGE", normalSide: "DEBIT" },
  // 622200 (Formwise's own platform commission) and 622600 (Honoraires) are distinct accounts
  // — do not conflate them (see default-categories.ts doc comment on the commissionFormwise fix).
  { code: "622200", label: "Commissions et courtages sur ventes",                type: "EXPENSE", section: "OPERATING", nature: "CHARGE", normalSide: "DEBIT" },
  { code: "622600", label: "Honoraires",                                         type: "EXPENSE", section: "OPERATING", nature: "CHARGE", normalSide: "DEBIT" },
  { code: "623000", label: "Publicité, publications, relations publiques",       type: "EXPENSE", section: "OPERATING", nature: "CHARGE", normalSide: "DEBIT" },
  { code: "624000", label: "Transports de biens et transports collectifs du personnel", type: "EXPENSE", section: "OPERATING", nature: "CHARGE", normalSide: "DEBIT" },
  { code: "625100", label: "Voyages et déplacements",                           type: "EXPENSE", section: "OPERATING", nature: "CHARGE", normalSide: "DEBIT" },
  { code: "625600", label: "Missions",                                         type: "EXPENSE", section: "OPERATING", nature: "CHARGE", normalSide: "DEBIT" },
  { code: "625700", label: "Réceptions",                                       type: "EXPENSE", section: "OPERATING", nature: "CHARGE", normalSide: "DEBIT" },
  { code: "626000", label: "Frais postaux et de télécommunications",           type: "EXPENSE", section: "OPERATING", nature: "CHARGE", normalSide: "DEBIT" },
  // Stripe's own per-charge processing fee shares this account with genuine bank charges —
  // tracked as its own category (fraisStripe) for internal reporting, but both point at the
  // same PCG account per the reworked default catalog (see default-categories.ts).
  { code: "627000", label: "Services bancaires et assimilés",                    type: "EXPENSE", section: "OPERATING", nature: "CHARGE", normalSide: "DEBIT" },
  { code: "628100", label: "Concours divers : cotisations",                      type: "EXPENSE", section: "OPERATING", nature: "CHARGE", normalSide: "DEBIT" },
  { code: "641000", label: "Rémunérations du personnel",                         type: "EXPENSE", section: "OPERATING", nature: "CHARGE", normalSide: "DEBIT" },
  { code: "645000", label: "Charges de sécurité sociale et de prévoyance",       type: "EXPENSE", section: "OPERATING", nature: "CHARGE", normalSide: "DEBIT" },
  { code: "651100", label: "Redevances pour solutions informatiques",            type: "EXPENSE", section: "OPERATING", nature: "CHARGE", normalSide: "DEBIT" },
  { code: "658000", label: "Pénalités et autres charges",                        type: "EXPENSE", section: "OPERATING", nature: "CHARGE", normalSide: "DEBIT" },

  // Imobilizado (classe 2/6-8) — informatif seulement, voir FinanceSection.IMMOBILISATION.
  // 218300's real ledger nature is ACTIF (it's the asset itself), not CHARGE — see the
  // `nature` doc comment above. 681000 is a genuine CHARGE (dotation aux amortissements).
  { code: "218300", label: "Matériel de bureau et matériel informatique",        type: "EXPENSE", section: "IMMOBILISATION", nature: "ACTIF",  normalSide: "DEBIT" },
  { code: "681000", label: "Dépréciations / Amortissements",                     type: "EXPENSE", section: "IMMOBILISATION", nature: "CHARGE", normalSide: "DEBIT" },
  // Immobilisations incorporelles (FORM-107, rubricas restantes) — même logique que 218300 :
  // une dépense catégorisée ici (ex. achat d'un logiciel/licence) devient éligible à
  // immobilisation via /api/finances/immobilisations/eligible-expenses, qui route vers le bon
  // triplet de comptes (205000/280500/681110) selon le code de catégorie choisi — voir
  // immobilisations/route.ts. Pas de catégorie par défaut pour ce code, même choix délibéré
  // que pour 218300 (voir default-categories.ts) : un trésorier crée/active une catégorie
  // personnalisée pointant dessus quand il en a besoin.
  { code: "205000", label: "Concessions et droits similaires, brevets, licences", type: "EXPENSE", section: "IMMOBILISATION", nature: "ACTIF", normalSide: "DEBIT" },
]

// Ledger-only infrastructure accounts: never selectable by a FinanceCategory (no `type`/
// `section` the category form would offer), used exclusively as the technical counterpart side
// of a journal entry posted from post-income-expense.ts (FORM-107 Fase 1). Kept in this file
// rather than hardcoded in chart-accounts-seed.ts so every account's nature stays declared in
// one place.
export interface LedgerInfrastructureAccount {
  code:       string
  label:      string
  nature:     ChartAccountNature
  normalSide: NormalBalanceSide
}

export const LEDGER_INFRASTRUCTURE_ACCOUNTS: LedgerInfrastructureAccount[] = [
  { code: "531000", label: "Caisse", nature: "ACTIF", normalSide: "DEBIT" },
  // Counterpart for an Income not yet linked to a BankAccount via BankReconciliation — "valeurs
  // à l'encaissement" is itself one of the maquette's Disponibilités sub-lines, so a balance
  // here surfaces transparently inside that rubrique rather than as an unexplained suspense.
  { code: "511000", label: "Valeurs à l'encaissement", nature: "ACTIF", normalSide: "DEBIT" },
  // Counterpart for an Expense not yet linked to a BankAccount via BankReconciliation. Expected
  // to carry a transient CREDIT (negative) balance until reconciliation moves it to the real
  // 512xxx account — that's normal for a compte d'attente, not an error.
  { code: "471000", label: "Compte d'attente", nature: "ACTIF", normalSide: "DEBIT" },
  // Absorbs the exercice's net result (classe 6/7 accounts never carry forward — they're
  // temporary) into Fonds propres as part of the opening entry of the FOLLOWING exercice — see
  // opening-balance.ts. Carries a CREDIT balance on a profit, a (contra-normal) DEBIT balance
  // on a deficit — "un déficit réduit le patrimoine net" (FORM-107).
  { code: "120000", label: "Résultat de l'exercice", nature: "PASSIF", normalSide: "CREDIT" },
  // FORM-107 Fase 2 — Immobilisations. Never chosen by a treasurer for a regular Income/
  // Expense; only ever touched by post-closing-depreciation.ts. 281830's nature is ACTIF (it
  // belongs in the Bilan's Actif immobilisé section, as a deduction from 218300's gross value)
  // even though its normalSide is CREDIT — a contra-asset, same "nature says where, normalSide
  // says which side" split as every other account here.
  { code: "281830", label: "Amortissements du matériel de bureau et du matériel informatique", nature: "ACTIF",  normalSide: "CREDIT" },
  { code: "681120", label: "Dotations aux amortissements des immobilisations corporelles",      nature: "CHARGE", normalSide: "DEBIT" },
  { code: "681110", label: "Dotations aux amortissements des immobilisations incorporelles",    nature: "CHARGE", normalSide: "DEBIT" },
  // Fournisseurs d'immobilisations — reserved for FORM-107 Fase 3 (partial payment of an
  // invoiced asset purchase). Seeded now so the chart doesn't need a second migration later.
  { code: "404000", label: "Fournisseurs d'immobilisations", nature: "PASSIF", normalSide: "CREDIT" },
  // Fournisseurs — ordinary (non-Immobilisation) trade payables, FORM-117. Same role as 404000
  // one section up, for a plain FactureRecue's accrual charge instead of an asset acquisition.
  { code: "401000", label: "Fournisseurs", nature: "PASSIF", normalSide: "CREDIT" },

  // Contra-asset pour 205000, même rôle que 281830 pour 218300.
  { code: "280500", label: "Amortissements des concessions et droits similaires", nature: "ACTIF", normalSide: "CREDIT" },

  // Immobilisations financières — prêts accordés et dépôts/cautions versés. Ne s'amortissent
  // pas (pas de dotation/compte contra) : postés uniquement via le lançamento manual (voir
  // journal/post-manual-entry.ts), jamais via le flux Immobilisation/dépréciation.
  { code: "274000", label: "Prêts", nature: "ACTIF", normalSide: "DEBIT" },
  { code: "275000", label: "Dépôts et cautionnements versés", nature: "ACTIF", normalSide: "DEBIT" },

  // Provisions pour risques et charges — montant décidé par le trésorier, jamais calculé
  // automatiquement (contrairement à l'amortissement) : posté via le lançamento manual.
  { code: "151000", label: "Provisions pour risques et charges", nature: "PASSIF", normalSide: "CREDIT" },
  { code: "681500", label: "Dotations aux provisions pour risques et charges", nature: "CHARGE", normalSide: "DEBIT" },
  { code: "781500", label: "Reprises sur provisions pour risques et charges", nature: "PRODUIT", normalSide: "CREDIT" },

  // Comptes de régularisation — répartissent une charge/un produit déjà comptabilisé entre
  // l'exercice en cours et le suivant. Montant décidé par le trésorier (ex. prime d'assurance
  // payée d'avance) : posté via le lançamento manual, jamais calculé automatiquement.
  { code: "486000", label: "Charges constatées d'avance", nature: "ACTIF", normalSide: "DEBIT" },
  { code: "487000", label: "Produits constatés d'avance", nature: "PASSIF", normalSide: "CREDIT" },

  // Fonds dédiés — ressources reçues pour un projet/don restreint, pas encore utilisées. Même
  // logique que Provisions : montant décidé par le trésorier au lançamento manual, jamais
  // calculé automatiquement (aucun modèle de "fonds restreint" n'existe dans le produit — voir
  // le contexte du plan Grupo B).
  { code: "194000", label: "Fonds dédiés", nature: "PASSIF", normalSide: "CREDIT" },
  { code: "689000", label: "Engagements à réaliser sur ressources affectées", nature: "CHARGE", normalSide: "DEBIT" },
  { code: "789000", label: "Report des ressources non utilisées des exercices antérieurs", nature: "PRODUIT", normalSide: "CREDIT" },
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

// The account's official "intitulé comptable" — null for a code no longer in the controlled
// list (e.g. a legacy/retired code still sitting on an old FinanceCategory row).
export function labelForAccountCode(code: string): string | null {
  const normalized = normalizeAccountingCode(code)
  return REFERENCE_ACCOUNTS.find(a => a.code === normalized)?.label ?? null
}
