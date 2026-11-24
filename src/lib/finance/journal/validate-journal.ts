// src/lib/finance/journal/validate-journal.ts
// Structural health checks on the ledger itself, plus (FORM-107 Fase 4/5) the richer Bilan
// validation now that the rubrique mapping exists: conta sem rubrica and ativo≠passivo are
// delegated to computeBilanPeriod itself (bilan.ts), since computing the Bilan and detecting
// those two conditions are the same pass over the same JournalLine rows.
//
// validateResultDivergence (below) compares the journal's own result against the Compte de
// résultat's — the two now agree by construction once depreciation is folded into both (see
// income-statement.ts's dotation line), with one real, expected exception: Income/Expense rows
// only reach the journal via a write-time hook on a few flows, or via ensurePostedJournalEntries
// (only ever run at exercice closing or by the backfill script) — see post-income-expense.ts's
// own doc comment. A still-open exercice whose activity hasn't been caught up yet will
// genuinely diverge, and that's exactly the condition FORM-107 wants surfaced: don't treat the
// Bilan as definitive until the journal has caught up (close the exercice, or re-run the
// backfill script).
import { prisma } from "@/lib/prisma/client"
import { computeBilanPeriod } from "@/lib/finance/bilan"
import { computeIncomeStatementPeriod } from "@/lib/finance/income-statement"
import { findUnpostableEntries } from "@/lib/finance/journal/post-income-expense"
import type { BilanValidationIssue } from "@/lib/finance/bilan-shared"

// Same code+params shape as BilanValidationIssue (see that type's doc comment) — a caller
// renders `code` through finances.bilan.issues.messages.<code> in its own locale, never a
// pre-built server string.
export type JournalValidationIssue = BilanValidationIssue

// Flags a missing (not merely absent-because-first-exercice) opening entry: the previous
// exercice has real journal activity, but this exercice has no "opening-balance:<id>" entry —
// e.g. because it was closed before postJournalEntry/generateOpeningBalanceForExercice
// existed, or the previous exercice's own entries were never backfilled.
export async function validateOpeningBalance(associationId: string, exerciceId: string): Promise<JournalValidationIssue[]> {
  const exercice = await prisma.exerciceComptable.findUnique({ where: { id: exerciceId } })
  if (!exercice) return []

  const previous = await prisma.exerciceComptable.findFirst({
    where:   { associationId, endDate: { lt: exercice.startDate } },
    orderBy: { endDate: "desc" },
  })
  if (!previous) return [] // first exercice ever — nothing to open

  const previousHasActivity = await prisma.journalEntry.findFirst({
    where: { associationId, exerciceId: previous.id },
  })
  if (!previousHasActivity) return [] // previous exercice has no journal activity to carry forward

  const opening = await prisma.journalEntry.findUnique({
    where: { idempotencyKey: `opening-balance:${exerciceId}` },
  })
  if (!opening) {
    return [{ code: "OPENING_BALANCE_MISSING", params: { previousLabel: previous.label } }]
  }
  return []
}

// Every JournalEntry already balances by construction (postJournalEntry enforces it at write
// time) — this re-derives the exercice's grand total as a defense against any future write
// path that might bypass postJournalEntry (e.g. a hand-run SQL fix).
export async function validateTrialBalance(associationId: string, exerciceId: string): Promise<JournalValidationIssue[]> {
  const sums = await prisma.journalLine.aggregate({
    where: { journalEntry: { associationId, exerciceId } },
    _sum:  { debit: true, credit: true },
  })
  const debitCents  = Math.round(Number(sums._sum.debit  ?? 0) * 100)
  const creditCents = Math.round(Number(sums._sum.credit ?? 0) * 100)
  if (debitCents !== creditCents) {
    const fmt = (cents: number) => (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
    return [{ code: "TRIAL_BALANCE_UNBALANCED", params: { debit: fmt(debitCents), credit: fmt(creditCents) } }]
  }
  return []
}

// Delegates to computeBilanPeriod — ACCOUNT_WITHOUT_RUBRIQUE and ACTIF_PASSIF_MISMATCH are
// detected as a side effect of the same aggregation the Bilan screen itself runs, so there's
// no second query path that could drift out of sync with what the screen actually shows.
export async function validateBilan(associationId: string, exerciceId: string): Promise<JournalValidationIssue[]> {
  const exercice = await prisma.exerciceComptable.findUnique({
    where:  { id: exerciceId },
    select: { id: true, label: true, startDate: true, endDate: true },
  })
  if (!exercice) return []
  const bilan = await computeBilanPeriod(associationId, exercice)
  return bilan.issues
}

// Compares the journal's own result for the exercice (computeBilanPeriod's `resultOfPeriod`,
// the live classe 6/7 fold) against the Compte de résultat's `result` for the same exercice.
// They're computed from entirely different source tables (JournalLine vs. Income/Expense), so
// agreement isn't automatic — see this module's doc comment for the one real cause of a
// legitimate divergence (the journal hasn't caught up with this exercice's activity yet).
export async function validateResultDivergence(associationId: string, exerciceId: string): Promise<JournalValidationIssue[]> {
  const exercice = await prisma.exerciceComptable.findUnique({
    where:  { id: exerciceId },
    select: { id: true, label: true, startDate: true, endDate: true },
  })
  if (!exercice) return []

  const [bilan, statement] = await Promise.all([
    computeBilanPeriod(associationId, exercice),
    computeIncomeStatementPeriod(associationId, exercice),
  ])

  const journalCents    = Math.round(bilan.resultOfPeriod * 100)
  const statementCents  = Math.round(statement.result * 100)
  if (journalCents !== statementCents) {
    const fmt = (cents: number) => (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
    return [{ code: "RESULT_DIVERGENCE", params: { journal: fmt(journalCents), statement: fmt(statementCents) } }]
  }
  return []
}

// Distinct from RESULT_DIVERGENCE above: that one tells the treasurer to "relancez la
// synchronisation" (see the Bilan refresh button), which fixes a row that's merely pending
// catch-up — but a row with no resolvable category/accountingCode will never post via that
// same sync, sync or not. Kept as its own check (not folded into validateResultDivergence) so
// the two causes never get conflated into one message.
export async function validateUnpostedEntries(associationId: string, exerciceId: string): Promise<JournalValidationIssue[]> {
  const unpostable = await findUnpostableEntries(associationId, exerciceId)
  if (unpostable.count === 0) return []
  const fmt = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
  return [{ code: "UNPOSTED_ENTRIES", params: { count: String(unpostable.count), amount: fmt(unpostable.amount) } }]
}

export async function validateJournalForExercice(associationId: string, exerciceId: string): Promise<JournalValidationIssue[]> {
  const [opening, trialBalance, bilan, resultDivergence, unpostedEntries] = await Promise.all([
    validateOpeningBalance(associationId, exerciceId),
    validateTrialBalance(associationId, exerciceId),
    validateBilan(associationId, exerciceId),
    validateResultDivergence(associationId, exerciceId),
    validateUnpostedEntries(associationId, exerciceId),
  ])
  return [...opening, ...trialBalance, ...bilan, ...resultDivergence, ...unpostedEntries]
}
