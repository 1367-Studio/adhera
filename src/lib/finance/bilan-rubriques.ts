// src/lib/finance/bilan-rubriques.ts
// Static ChartAccount code → rubrique du Bilan mapping — see FORM-107 Fase 4. Kept separate
// from bilan.ts (which is server-only) so it can be unit-tested without prisma, and separate
// from chart-of-accounts.ts (which is about FinanceCategory's reference list, not the Bilan's
// own grouping) even though the two inevitably describe the same real accounts.
//
// Deliberately covers only ACTIF/PASSIF-natured accounts: CHARGE/PRODUIT accounts (classe 6/7)
// never appear on the Bilan directly — computeBilanPeriod folds their net, for the exercice
// being viewed, into the "fondsPropres" rubrique as the not-yet-closed result of the period.
import { BILAN_RUBRIQUE_KEYS, type BilanRubriqueKey, type BilanSideKey } from "@/lib/finance/bilan-shared"

export interface BilanRubriqueDef {
  key:     BilanRubriqueKey
  side:    BilanSideKey
  order:   number // display order within its side
  // See BilanRubrique.isMemo's doc comment — computed live, not from the journal, excluded
  // from BilanSide.total and the actif≠passif check.
  isMemo?: boolean
}

export const BILAN_RUBRIQUES: BilanRubriqueDef[] = [
  { key: "immobilisationsCorporelles",   side: "ACTIF",  order: 0 },
  { key: "immobilisationsIncorporelles", side: "ACTIF",  order: 1 },
  { key: "immobilisationsFinancieres",   side: "ACTIF",  order: 2 },
  { key: "disponibilites",               side: "ACTIF",  order: 3 },
  { key: "chargesConstateesDavance",     side: "ACTIF",  order: 4 },
  { key: "creances",                     side: "ACTIF",  order: 5, isMemo: true },
  { key: "stocksEtEnCours",              side: "ACTIF",  order: 6, isMemo: true },
  { key: "fondsPropres",                 side: "PASSIF", order: 0 },
  { key: "provisions",                   side: "PASSIF", order: 1 },
  { key: "dettes",                       side: "PASSIF", order: 2 },
  { key: "produitsConstatesDavance",     side: "PASSIF", order: 3 },
  { key: "fondsDedies",                  side: "PASSIF", order: 4 },
]

if (BILAN_RUBRIQUES.length !== BILAN_RUBRIQUE_KEYS.length) {
  throw new Error("bilan-rubriques: BILAN_RUBRIQUES is out of sync with BILAN_RUBRIQUE_KEYS")
}

export interface AccountRubriqueMatch {
  rubrique: BilanRubriqueKey
  // True for a contra-account (e.g. 281830 against 218300) — its normal-side-positive balance
  // is SUBTRACTED from the rubrique's total instead of added.
  contra: boolean
}

// 218300/281830 — Immobilisations corporelles (brut et son amortissement, FORM-107 Fase 2/3).
// 205000/280500 — Immobilisations incorporelles (même logique, autre classe d'actif).
// 274000/275000 — Immobilisations financières (prêts, dépôts et cautionnements — ne
// s'amortissent pas, pas de compte contra).
// 531000/511000/471000/512xxx — Disponibilités (caisse, valeurs à l'encaissement, compte
// d'attente, un compte par BankAccount — see chart-accounts-seed.ts).
// 486000 — Charges constatées d'avance.
// 120000 — Fonds propres (report à nouveau cumulé, voir computeBilanPeriod pour le libellé).
// 151000 — Provisions pour risques et charges.
// 404000 — Dettes (fournisseurs d'immobilisations, FORM-107 Fase 3).
// 401000 — Dettes (fournisseurs ordinaires, FORM-117).
// 487000 — Produits constatés d'avance.
// 194000 — Fonds dédiés.
// creances/stocksEtEnCours are deliberately absent here — they're memo rubriques, never
// populated from a ChartAccount/JournalLine (see computeBilanPeriod).
export function rubriqueForAccountCode(code: string): AccountRubriqueMatch | null {
  if (code === "218300") return { rubrique: "immobilisationsCorporelles", contra: false }
  if (code === "281830") return { rubrique: "immobilisationsCorporelles", contra: true }
  if (code === "205000") return { rubrique: "immobilisationsIncorporelles", contra: false }
  if (code === "280500") return { rubrique: "immobilisationsIncorporelles", contra: true }
  if (code === "274000" || code === "275000") return { rubrique: "immobilisationsFinancieres", contra: false }
  if (code === "531000" || code === "511000" || code === "471000") return { rubrique: "disponibilites", contra: false }
  if (code.startsWith("512")) return { rubrique: "disponibilites", contra: false }
  if (code === "486000") return { rubrique: "chargesConstateesDavance", contra: false }
  if (code === "120000") return { rubrique: "fondsPropres", contra: false }
  if (code === "151000") return { rubrique: "provisions", contra: false }
  if (code === "404000" || code === "401000") return { rubrique: "dettes", contra: false }
  if (code === "487000") return { rubrique: "produitsConstatesDavance", contra: false }
  if (code === "194000") return { rubrique: "fondsDedies", contra: false }
  return null
}
