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
  key:   BilanRubriqueKey
  side:  BilanSideKey
  order: number // display order within its side
}

export const BILAN_RUBRIQUES: BilanRubriqueDef[] = [
  { key: "immobilisationsCorporelles", side: "ACTIF",  order: 0 },
  { key: "disponibilites",             side: "ACTIF",  order: 1 },
  { key: "fondsPropres",               side: "PASSIF", order: 0 },
  { key: "dettes",                     side: "PASSIF", order: 1 },
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
// 531000/511000/471000/512xxx — Disponibilités (caisse, valeurs à l'encaissement, compte
// d'attente, un compte par BankAccount — see chart-accounts-seed.ts).
// 120000 — Fonds propres (report à nouveau cumulé, voir computeBilanPeriod pour le libellé).
// 404000 — Dettes (fournisseurs d'immobilisations, FORM-107 Fase 3).
export function rubriqueForAccountCode(code: string): AccountRubriqueMatch | null {
  if (code === "218300") return { rubrique: "immobilisationsCorporelles", contra: false }
  if (code === "281830") return { rubrique: "immobilisationsCorporelles", contra: true }
  if (code === "531000" || code === "511000" || code === "471000") return { rubrique: "disponibilites", contra: false }
  if (code.startsWith("512")) return { rubrique: "disponibilites", contra: false }
  if (code === "120000") return { rubrique: "fondsPropres", contra: false }
  if (code === "404000") return { rubrique: "dettes", contra: false }
  return null
}
