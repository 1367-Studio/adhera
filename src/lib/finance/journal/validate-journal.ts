// src/lib/finance/journal/validate-journal.ts
// Structural health checks on the ledger itself, plus (FORM-107 Fase 4) the richer Bilan
// validation now that the rubrique mapping exists: conta sem rubrica and ativo≠passivo are
// delegated to computeBilanPeriod itself (bilan.ts), since computing the Bilan and detecting
// those two conditions are the same pass over the same JournalLine rows. Divergência de
// resultado (journal result vs. the Compte de résultat's category-based result) is NOT
// implemented here: the two are expected to genuinely differ once any depreciation has been
// posted (681110/681120 are real CHARGE postings in the journal, but FinanceSection.IMMOBILISATION
// is deliberately excluded from computeIncomeStatementPeriod's `result` — see RESULT_SECTIONS in
// income-statement-shared.ts), so a strict equality check would alarm on expected behavior
// rather than a real bug. Revisit only if/when the two are meant to be reconciled by design.
import { prisma } from "@/lib/prisma/client"
import { computeBilanPeriod } from "@/lib/finance/bilan"
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

export async function validateJournalForExercice(associationId: string, exerciceId: string): Promise<JournalValidationIssue[]> {
  const [opening, trialBalance, bilan] = await Promise.all([
    validateOpeningBalance(associationId, exerciceId),
    validateTrialBalance(associationId, exerciceId),
    validateBilan(associationId, exerciceId),
  ])
  return [...opening, ...trialBalance, ...bilan]
}
