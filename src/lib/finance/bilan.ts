// src/lib/finance/bilan.ts
// Computes the Bilan (balance sheet) for one exercice from the real double-entry ledger
// (JournalEntry/JournalLine) — see FORM-107 Fase 4. Distinct from income-statement.ts, which
// derives the Compte de résultat from Income/Expense + FinanceCategory rows; the two read
// different source tables and are expected to agree on the operating result (see the
// RESULT_DIVERGENCE note below for the one deliberate exception).
//
// Scoped strictly by `exerciceId`, never by a cumulative `date <= asOfDate` range: every
// exercice's own opening entry (see journal/opening-balance.ts) already restates the true
// carried-forward balance of every ACTIF/PASSIF account as of its start, so summing only this
// exercice's own JournalLine rows (its opening entry + its own movements) gives the exact
// ending balance — summing across exercice boundaries by date instead would double-count
// whatever a prior opening entry already restated.
import { prisma } from "@/lib/prisma/client"
import { rubriqueForAccountCode, BILAN_RUBRIQUES } from "@/lib/finance/bilan-rubriques"
import type {
  BilanPeriod, BilanSide, BilanRubrique, BilanValidationIssue, BilanSideKey, ExerciceRef,
} from "@/lib/finance/bilan-shared"

export type { ExerciceRef, BilanPeriod }

const RESULT_ACCOUNT_CODE = "120000"
const VIRTUAL_PERIOD_RESULT_ACCOUNT_ID = "virtual:resultat-periode"

// Same fr-FR currency format the client uses for every other amount on this screen (see
// bilan-view.tsx's `fmt`) — kept server-side here only for the ACTIF_PASSIF_MISMATCH i18n
// param, so a validation message embeds the same figure a treasurer sees in the tables above it.
function fmtAmount(n: number): string {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
}

function emptySide(side: BilanSideKey): BilanSide {
  return {
    rubriques: BILAN_RUBRIQUES
      .filter(r => r.side === side)
      .sort((a, b) => a.order - b.order)
      .map(r => ({ key: r.key, accounts: [], total: 0 })),
    total: 0,
  }
}

function emptyPeriod(exercice: ExerciceRef | null): BilanPeriod {
  return { exercice, actif: emptySide("ACTIF"), passif: emptySide("PASSIF"), balanced: true, issues: [] }
}

export async function computeBilanPeriod(
  associationId: string,
  exercice:      ExerciceRef | null,
): Promise<BilanPeriod> {
  if (!exercice) return emptyPeriod(null)

  const sums = await prisma.journalLine.groupBy({
    by:    ["chartAccountId"],
    where: { journalEntry: { associationId, exerciceId: exercice.id } },
    _sum:  { debit: true, credit: true },
  })
  if (sums.length === 0) return emptyPeriod(exercice)

  const accounts = await prisma.chartAccount.findMany({
    where:  { id: { in: sums.map(s => s.chartAccountId) } },
    select: { id: true, code: true, label: true, nature: true, normalSide: true },
  })
  const byId = new Map(accounts.map(a => [a.id, a]))

  const actif  = emptySide("ACTIF")
  const passif = emptySide("PASSIF")
  const rubriqueByKey = new Map<string, BilanRubrique>(
    [...actif.rubriques, ...passif.rubriques].map(r => [r.key, r]),
  )
  const issues: BilanValidationIssue[] = []
  // Net credit-minus-debit of every classe 6/7 account posted under this exercice — this
  // exercice's own operating result, whether or not a following exercice has since closed over
  // it (closing never edits/deletes these lines — see JournalEntry's doc comment).
  let resultCents = 0

  for (const s of sums) {
    const account = byId.get(s.chartAccountId)
    if (!account) continue
    const debitCents  = Math.round(Number(s._sum.debit  ?? 0) * 100)
    const creditCents = Math.round(Number(s._sum.credit ?? 0) * 100)
    if (debitCents === 0 && creditCents === 0) continue

    if (account.nature === "CHARGE" || account.nature === "PRODUIT") {
      resultCents += creditCents - debitCents
      continue
    }

    // Positive = balance sits on the account's normal side, same convention as
    // journal/opening-balance.ts's computeAccountBalancesAsOf.
    const netCents = account.normalSide === "DEBIT" ? debitCents - creditCents : creditCents - debitCents
    if (netCents === 0) continue

    const match = rubriqueForAccountCode(account.code)
    if (!match) {
      issues.push({ code: "ACCOUNT_WITHOUT_RUBRIQUE", params: { code: account.code, label: account.label } })
      continue
    }

    const rubrique = rubriqueByKey.get(match.rubrique)!
    const amount   = (match.contra ? -netCents : netCents) / 100
    // 120000 literally reads "Résultat de l'exercice" as a ledger label (the name it's seeded
    // under for journal/opening-balance.ts's own entry lines), but from THIS exercice's own
    // Bilan it's the cumulative equity carried IN at the exercice's start — "Résultat de
    // l'exercice" is reserved below for the live classe 6/7 fold instead, matching standard
    // Fonds propres presentation (report à nouveau + résultat de l'exercice as two lines).
    // labelKey (translated client-side) overrides the raw account.label in that one case.
    const labelKey = account.code === RESULT_ACCOUNT_CODE ? "reportANouveau" as const : undefined
    rubrique.accounts.push({ chartAccountId: account.id, code: account.code, label: account.label, labelKey, amount })
    rubrique.total += amount
  }

  if (resultCents !== 0) {
    const fondsPropres = rubriqueByKey.get("fondsPropres")!
    const amount = resultCents / 100
    fondsPropres.accounts.push({
      chartAccountId: VIRTUAL_PERIOD_RESULT_ACCOUNT_ID,
      code:           "",
      label:          "",
      labelKey:       "resultatExercice",
      amount,
    })
    fondsPropres.total += amount
  }

  actif.total  = actif.rubriques.reduce((sum, r) => sum + r.total, 0)
  passif.total = passif.rubriques.reduce((sum, r) => sum + r.total, 0)

  const diffCents = Math.round((actif.total - passif.total) * 100)
  const balanced  = diffCents === 0
  if (!balanced) {
    issues.push({
      code:   "ACTIF_PASSIF_MISMATCH",
      params: { actif: fmtAmount(actif.total), passif: fmtAmount(passif.total) },
    })
  }

  return { exercice, actif, passif, balanced, issues }
}
