// src/lib/finance/bilan-shared.ts
// Split out from bilan.ts because that module imports `prisma` (server-only) — this half is
// safe to import from the client component that renders the report. Mirrors the
// income-statement.ts/income-statement-shared.ts split.

export type BilanSideKey = "ACTIF" | "PASSIF"

// Static rubriques du Bilan — see bilan-rubriques.ts for the account-code mapping. Listed here
// (not derived from Prisma) so this file stays importable from client components.
export const BILAN_RUBRIQUE_KEYS = [
  "immobilisationsCorporelles", "immobilisationsIncorporelles", "immobilisationsFinancieres",
  "disponibilites", "chargesConstateesDavance",
  // creances/stocksEtEnCours are "memo" rubriques (see isMemo on BilanRubriqueDef) — computed
  // live from Cotisation/Facture/BoutiqueVariante, never from JournalLine, excluded from
  // actif.total and the ACTIF_PASSIF_MISMATCH check. See FORM-107 Grupo B's context.
  "creances", "stocksEtEnCours",
  "fondsPropres", "provisions", "dettes", "produitsConstatesDavance", "fondsDedies",
] as const
export type BilanRubriqueKey = typeof BILAN_RUBRIQUE_KEYS[number]

export interface ExerciceRef {
  id:        string
  label:     string
  startDate: Date
  endDate:   Date
}

export interface BilanAccountRow {
  // "virtual:resultat-periode" for the synthetic not-yet-closed classe 6/7 fold, or
  // "memo:creances-cotisations" / "memo:creances-factures" / "memo:stocks" for the Grupo B
  // memo rubriques (see computeBilanPeriod's populateCreancesMemo/populateStocksMemo) — none
  // of these are ever a real drill-down target.
  chartAccountId: string
  code:           string
  label:          string
  amount:         number
  // Set only for rows computeBilanPeriod itself labels (120000, the virtual result fold, and
  // the memo rubrique lines) — the client renders finances.bilan.accountLabels.<labelKey>
  // instead of `label` in that case, so these stay translated. Every other row's `label` is
  // the raw ChartAccount.label (seeded in French only, like the rest of the ledger — a
  // pre-existing limitation this screen doesn't attempt to fix).
  labelKey?: "reportANouveau" | "resultatExercice" | "creancesCotisations" | "creancesFactures" | "creancesFacturesEnRetard" | "stocksEstimatedValue"
}

export interface BilanRubrique {
  key:      BilanRubriqueKey
  accounts: BilanAccountRow[]
  total:    number
  // True for "creances"/"stocksEtEnCours" — computed live from source tables, not from the
  // journal, and never included in BilanSide.total or the actif≠passif check (see
  // computeBilanPeriod). The client renders these in a visually separate block with an
  // "estimation, non comptabilisée" notice so nobody mistakes them for reconciled figures.
  isMemo?: boolean
  // Set only on "stocksEtEnCours" when some variantes with stock > 0 have no costPrice (see
  // populateStocksMemo) — those contribute 0 to the estimate rather than blocking it, but
  // silently doing so would understate "Valeur du stock estimée" with no indication why.
  // `count` is always > 0 when this is set.
  caveat?: { labelKey: "stocksMissingCostPrice"; count: number }
}

export interface BilanSide {
  rubriques: BilanRubrique[]
  total:     number
}

// `code` selects the i18n template under finances.bilan.issues.messages.<code> — `params` are
// its ICU interpolation values. Never a pre-built message string: this type crosses into a
// client component that must render it in the viewer's own locale, not the server's hardcoded
// French (see computeBilanPeriod / validateOpeningBalance / validateTrialBalance).
export interface BilanValidationIssue {
  code:   string
  params: Record<string, string>
}

export interface BilanPeriod {
  exercice: ExerciceRef | null
  actif:    BilanSide
  passif:   BilanSide
  balanced: boolean
  issues:   BilanValidationIssue[]
  // Net credit-minus-debit of every classe 6/7 (CHARGE/PRODUIT) JournalLine posted under this
  // exercice — the journal's own view of the period's result, folded into fondsPropres as the
  // "Résultat de l'exercice" row (see computeBilanPeriod). Exposed here too so
  // validateResultDivergence can compare it against computeIncomeStatementPeriod's `result`
  // without re-deriving it from fondsPropres.accounts.
  resultOfPeriod: number
}
