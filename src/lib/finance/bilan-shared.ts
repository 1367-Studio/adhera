// src/lib/finance/bilan-shared.ts
// Split out from bilan.ts because that module imports `prisma` (server-only) — this half is
// safe to import from the client component that renders the report. Mirrors the
// income-statement.ts/income-statement-shared.ts split.

export type BilanSideKey = "ACTIF" | "PASSIF"

// Static rubriques du Bilan — see bilan-rubriques.ts for the account-code mapping. Listed here
// (not derived from Prisma) so this file stays importable from client components.
export const BILAN_RUBRIQUE_KEYS = ["immobilisationsCorporelles", "disponibilites", "fondsPropres", "dettes"] as const
export type BilanRubriqueKey = typeof BILAN_RUBRIQUE_KEYS[number]

export interface ExerciceRef {
  id:        string
  label:     string
  startDate: Date
  endDate:   Date
}

export interface BilanAccountRow {
  // "virtual:resultat-periode" for the synthetic not-yet-closed classe 6/7 fold — see
  // computeBilanPeriod. Never a real drill-down target in that case.
  chartAccountId: string
  code:           string
  label:          string
  amount:         number
  // Set only for the two rows computeBilanPeriod itself labels (120000 and the virtual result
  // fold) — the client renders finances.bilan.accountLabels.<labelKey> instead of `label` in
  // that case, so these stay translated. Every other row's `label` is the raw ChartAccount.label
  // (seeded in French only, like the rest of the ledger — a pre-existing limitation this
  // screen doesn't attempt to fix).
  labelKey?: "reportANouveau" | "resultatExercice"
}

export interface BilanRubrique {
  key:      BilanRubriqueKey
  accounts: BilanAccountRow[]
  total:    number
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
}
