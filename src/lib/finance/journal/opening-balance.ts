// src/lib/finance/journal/opening-balance.ts
// Generates the "report à nouveau" (opening balance) entry an exercice needs before its own
// Bilan can be trusted — see FORM-107 Fase 1. Only ACTIF/PASSIF accounts carry forward: CHARGE/
// PRODUIT (classe 6/7) are temporary, reset every exercice in real bookkeeping. Their net result
// doesn't vanish, though — it's folded into the "Résultat de l'exercice" equity line (code
// 120000) so the opening entry still balances and the carried-forward Passif already reflects
// last exercice's result, matching the ticket's "O resultado N exibido no passivo" requirement.
import { prisma } from "@/lib/prisma/client"
import { postJournalEntry, type PostJournalEntryResult, type PostJournalEntryLine } from "@/lib/finance/journal/post-journal-entry"
import { resolveChartAccountByCode } from "@/lib/finance/journal/chart-accounts-seed"

const RESULT_ACCOUNT_CODE = "120000"

interface AccountBalance {
  chartAccountId: string
  nature:         "ACTIF" | "PASSIF" | "CHARGE" | "PRODUIT"
  normalSide:     "DEBIT" | "CREDIT"
  debitCents:     number
  creditCents:    number
}

// Every JournalLine posted up to and including `asOfDate`, summed per account — the trial
// balance a report à nouveau (or a future Bilan/Grand livre screen) reads from.
async function computeAccountBalancesAsOf(associationId: string, asOfDate: Date): Promise<AccountBalance[]> {
  const sums = await prisma.journalLine.groupBy({
    by:    ["chartAccountId"],
    where: { journalEntry: { associationId, date: { lte: asOfDate } } },
    _sum:  { debit: true, credit: true },
  })
  if (sums.length === 0) return []

  const accounts = await prisma.chartAccount.findMany({
    where:  { id: { in: sums.map(s => s.chartAccountId) } },
    select: { id: true, nature: true, normalSide: true },
  })
  const byId = new Map(accounts.map(a => [a.id, a]))

  return sums.map(s => {
    const account = byId.get(s.chartAccountId)!
    return {
      chartAccountId: s.chartAccountId,
      nature:         account.nature,
      normalSide:     account.normalSide,
      debitCents:     Math.round(Number(s._sum.debit  ?? 0) * 100),
      creditCents:    Math.round(Number(s._sum.credit ?? 0) * 100),
    }
  })
}

// Idempotent (postJournalEntry dedups on "opening-balance:<exerciceId>") and safe to call on
// every exercice close — returns null when there's nothing to do: no previous exercice (this
// is the association's first), or the previous exercice has no journal activity at all yet.
export async function generateOpeningBalanceForExercice(
  associationId: string,
  exerciceId:    string,
): Promise<PostJournalEntryResult | null> {
  const exercice = await prisma.exerciceComptable.findUnique({ where: { id: exerciceId } })
  if (!exercice) return null

  const previous = await prisma.exerciceComptable.findFirst({
    where:   { associationId, endDate: { lt: exercice.startDate } },
    orderBy: { endDate: "desc" },
  })
  if (!previous) return null

  const balances = await computeAccountBalancesAsOf(associationId, previous.endDate)
  if (balances.length === 0) return null

  const resultAccount = await resolveChartAccountByCode(associationId, RESULT_ACCOUNT_CODE)
  if (!resultAccount) return null // chart not seeded for this association yet

  const lines: PostJournalEntryLine[] = []
  let resultCents = 0

  for (const b of balances) {
    if (b.nature === "CHARGE" || b.nature === "PRODUIT") {
      // Net contribution to the exercice's result, credit-positive convention — see the
      // module doc comment for the algebra behind why this is exactly what keeps the entry
      // balanced once added back as a single equity line below.
      resultCents += b.creditCents - b.debitCents
      continue
    }
    const netCents = b.debitCents - b.creditCents // positive = net debit
    if (netCents === 0) continue
    if (b.normalSide === "DEBIT") {
      if (netCents > 0) lines.push({ chartAccountId: b.chartAccountId, debit: netCents / 100 })
      else              lines.push({ chartAccountId: b.chartAccountId, credit: -netCents / 100 }) // contra (e.g. an overdraft)
    } else {
      if (netCents < 0) lines.push({ chartAccountId: b.chartAccountId, credit: -netCents / 100 })
      else              lines.push({ chartAccountId: b.chartAccountId, debit: netCents / 100 }) // contra
    }
  }

  if (resultCents > 0) {
    lines.push({ chartAccountId: resultAccount.id, credit: resultCents / 100, label: "Résultat de l'exercice" })
  } else if (resultCents < 0) {
    lines.push({ chartAccountId: resultAccount.id, debit: -resultCents / 100, label: "Résultat de l'exercice" })
  }

  if (lines.length === 0) return null

  return postJournalEntry({
    associationId,
    exerciceId,
    date:           exercice.startDate,
    label:          `Report à nouveau — ${previous.label}`,
    sourceType:     "OPENING_BALANCE",
    idempotencyKey: `opening-balance:${exerciceId}`,
    lines,
  })
}

// The ONE deliberate exception to "a JournalEntry is never edited or deleted" (see that
// model's doc comment): undoes the opening entry a fechamento generated in the FOLLOWING
// exercice, when that fechamento itself is being undone (réouverture). Safe only because this
// compensates an administrative action being reversed, not a correction to recorded history —
// callers (see exercices/[id]/route.ts) must only invoke this when the following exercice
// hasn't itself been closed on top of it yet.
export async function deleteOpeningBalanceForExercice(exerciceId: string): Promise<boolean> {
  const idempotencyKey = `opening-balance:${exerciceId}`
  const entry = await prisma.journalEntry.findUnique({ where: { idempotencyKey } })
  if (!entry) return false
  await prisma.journalEntry.delete({ where: { id: entry.id } })
  return true
}
