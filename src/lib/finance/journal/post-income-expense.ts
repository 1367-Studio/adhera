// src/lib/finance/journal/post-income-expense.ts
// Turns a cash-basis Income/Expense row into a real double-entry JournalEntry — the bridge
// between the existing single-entry model and the Fase 1 ledger (see FORM-107). Every call
// site that transitions Income.status/Expense.status should call syncIncomeJournal/
// syncExpenseJournal right after the write — see the exercices/[id]/route.ts closing hook and
// the backfill script for the two call sites that exist as of Fase 1.
import { prisma } from "@/lib/prisma/client"
import { postJournalEntry, type PostJournalEntryResult } from "@/lib/finance/journal/post-journal-entry"
import { ensureChartAccounts, resolveChartAccountByCode } from "@/lib/finance/journal/chart-accounts-seed"

const CASH_PAYMENT_METHOD = "ESPECES"
const CAISSE_CODE         = "531000"
const VALEURS_ENCAISSEMENT_CODE = "511000" // suspense counterpart for an unreconciled Income
// Suspense counterpart for an unreconciled Expense-like debit — exported for
// post-facture-recue-payment.ts's 404000 settlements, same role.
export const COMPTE_ATTENTE_CODE = "471000"

// Exported for post-facture-recue-payment.ts (FORM-107 Fase 3), which needs the exact same
// "reconciled bank account, else cash, else suspense" resolution for a 404000 settlement.
export async function resolveTresorerieAccount(
  associationId: string,
  paymentMethod: string | null,
  reconciledBankAccountId: string | null,
  suspenseCode: string,
) {
  if (reconciledBankAccountId) {
    const account = await prisma.chartAccount.findUnique({ where: { bankAccountId: reconciledBankAccountId } })
    if (account) return account
  }
  if (paymentMethod === CASH_PAYMENT_METHOD) {
    return resolveChartAccountByCode(associationId, CAISSE_CODE)
  }
  return resolveChartAccountByCode(associationId, suspenseCode)
}

// Posts (or no-ops if already posted) the journal entry for one PAID Income row. Returns null
// — not an error — when the row isn't eligible yet: no exerciceId resolved, or its
// FinanceCategory has no valid accountingCode. Both are surfaced to the treasurer as "lançamento
// pendente" in a future diagnostic view (Fase 4), never silently guessed.
export async function postIncomeToJournal(incomeId: string): Promise<PostJournalEntryResult | null> {
  const income = await prisma.income.findUnique({
    where:   { id: incomeId },
    include: { category: true, reconciliations: { include: { bankTransaction: true } } },
  })
  if (!income || income.status !== "PAID") return null
  if (!income.exerciceId) return null

  await ensureChartAccounts(income.associationId)

  const categoryAccount = await resolveChartAccountByCode(income.associationId, income.category?.accountingCode)
  if (!categoryAccount) return null

  const reconciledBankAccountId = income.reconciliations[0]?.bankTransaction.bankAccountId ?? null
  const tresorerieAccount = await resolveTresorerieAccount(
    income.associationId, income.paymentMethod, reconciledBankAccountId, VALEURS_ENCAISSEMENT_CODE,
  )
  if (!tresorerieAccount) return null

  const amount = Number(income.amount)
  return postJournalEntry({
    associationId:  income.associationId,
    exerciceId:     income.exerciceId,
    date:           income.date,
    label:          income.description || categoryAccount.label,
    sourceType:     "INCOME",
    idempotencyKey: `income:${income.id}`,
    incomeId:       income.id,
    lines: [
      { chartAccountId: tresorerieAccount.id, debit:  amount, label: "Encaissement" },
      { chartAccountId: categoryAccount.id,   credit: amount, label: categoryAccount.label },
    ],
  })
}

// Posts (or no-ops) the journal entry for one VALIDATED Expense row. Same eligibility/null
// contract as postIncomeToJournal. Works unchanged for a row marked isImmobilisation whose
// category already points at an ACTIF-nature account (e.g. 218300) — the debit/credit shape
// (debit the category's account, credit tesouraria) is the same whether that account is a
// CHARGE or an ACTIF; Fase 2 adds the dedicated Immobilisation model on top of this, it doesn't
// replace it.
export async function postExpenseToJournal(expenseId: string): Promise<PostJournalEntryResult | null> {
  const expense = await prisma.expense.findUnique({
    where:   { id: expenseId },
    include: { category: true, reconciliations: { include: { bankTransaction: true } } },
  })
  if (!expense || expense.status !== "VALIDATED") return null
  if (!expense.exerciceId) return null

  await ensureChartAccounts(expense.associationId)

  const categoryAccount = await resolveChartAccountByCode(expense.associationId, expense.category?.accountingCode)
  if (!categoryAccount) return null

  const reconciledBankAccountId = expense.reconciliations[0]?.bankTransaction.bankAccountId ?? null
  const tresorerieAccount = await resolveTresorerieAccount(
    expense.associationId, expense.paymentMethod, reconciledBankAccountId, COMPTE_ATTENTE_CODE,
  )
  if (!tresorerieAccount) return null

  const amount = Number(expense.amount)
  return postJournalEntry({
    associationId:  expense.associationId,
    exerciceId:     expense.exerciceId,
    date:           expense.date,
    label:          expense.description || categoryAccount.label,
    sourceType:     "EXPENSE",
    idempotencyKey: `expense:${expense.id}`,
    expenseId:      expense.id,
    lines: [
      { chartAccountId: categoryAccount.id,   debit:  amount, label: categoryAccount.label },
      { chartAccountId: tresorerieAccount.id, credit: amount, label: "Décaissement" },
    ],
  })
}

// Mirrors the original entry's lines (debit<->credit swapped) into a new reversing entry.
// Never edits/deletes the original — see JournalEntry's doc comment. Posted into the SAME
// exercice/date as the original: a refund can only happen while that exercice is still OUVERT
// (see the boutique refund route's own early-closure guard), so this is always a valid, still-
// open period to post into. Returns null if there's nothing to reverse (never posted, or
// already reversed).
async function reverseJournalEntry(idempotencyKey: string, reversalKey: string, sourceType: "INCOME_REVERSAL" | "EXPENSE_REVERSAL", label: string) {
  const original = await prisma.journalEntry.findUnique({ where: { idempotencyKey }, include: { lines: true } })
  if (!original) return null

  return postJournalEntry({
    associationId:     original.associationId,
    exerciceId:        original.exerciceId,
    date:              original.date,
    label:             `${label} (annulation)`,
    sourceType,
    idempotencyKey:    reversalKey,
    incomeId:          original.incomeId,
    expenseId:         original.expenseId,
    bankTransactionId: original.bankTransactionId,
    accountTransferId: original.accountTransferId,
    lines: original.lines.map(l => ({
      chartAccountId: l.chartAccountId,
      debit:  Number(l.credit),
      credit: Number(l.debit),
      label:  l.label ?? undefined,
    })),
  })
}

export async function reverseIncomeJournalEntry(incomeId: string): Promise<PostJournalEntryResult | null> {
  return reverseJournalEntry(`income:${incomeId}`, `income:${incomeId}:reversal`, "INCOME_REVERSAL", "Annulation encaissement")
}

export async function reverseExpenseJournalEntry(expenseId: string): Promise<PostJournalEntryResult | null> {
  return reverseJournalEntry(`expense:${expenseId}`, `expense:${expenseId}:reversal`, "EXPENSE_REVERSAL", "Annulation décaissement")
}

// Call right after writing Income.status, whatever the new value — resolves what the journal
// should look like for that row and reconciles it in one step (post if PAID, reverse if
// CANCELLED after having been posted, no-op otherwise/already-in-sync thanks to
// postJournalEntry's and reverseJournalEntry's own idempotency).
export async function syncIncomeJournal(incomeId: string): Promise<void> {
  const income = await prisma.income.findUnique({ where: { id: incomeId }, select: { status: true } })
  if (!income) return
  if (income.status === "PAID") {
    await postIncomeToJournal(incomeId)
  } else if (income.status === "CANCELLED") {
    await reverseIncomeJournalEntry(incomeId)
  }
}

export async function syncExpenseJournal(expenseId: string): Promise<void> {
  const expense = await prisma.expense.findUnique({ where: { id: expenseId }, select: { status: true } })
  if (!expense) return
  if (expense.status === "VALIDATED") {
    await postExpenseToJournal(expenseId)
  } else if (expense.status === "CANCELLED") {
    await reverseExpenseJournalEntry(expenseId)
  }
}

// Lazy catch-up, same posture as ensureDefaultFinanceCategories (src/lib/finance/
// ensure-default-categories.ts): instead of wiring syncIncomeJournal/syncExpenseJournal into
// every one of the ~20 existing call sites that create/transition an Income or Expense (most
// of them inside a prisma.$transaction — posting from there would read the row through a
// SEPARATE connection before that transaction commits, silently missing it), this scans for
// PAID/CANCELLED Income and VALIDATED/CANCELLED Expense rows and reconciles each one. Called
// explicitly at controlled points — the exercice-closing route before generating the next
// exercice's opening balance, and the backfill script — never from a request hot path.
// Not optimized for repeated full scans (no incremental cursor yet): fine for a closing/
// backfill operation, not meant to run on every report page load.
export async function ensurePostedJournalEntries(
  associationId: string,
  exerciceId?: string,
): Promise<{ posted: number; reversed: number }> {
  const [incomes, expenses] = await Promise.all([
    prisma.income.findMany({
      where:  { associationId, ...(exerciceId ? { exerciceId } : {}), status: { in: ["PAID", "CANCELLED"] } },
      select: { id: true, status: true },
    }),
    prisma.expense.findMany({
      where:  { associationId, ...(exerciceId ? { exerciceId } : {}), status: { in: ["VALIDATED", "CANCELLED"] } },
      select: { id: true, status: true },
    }),
  ])

  let posted = 0
  let reversed = 0
  for (const income of incomes) {
    if (income.status === "PAID") {
      if ((await postIncomeToJournal(income.id))?.created) posted++
    } else {
      if ((await reverseIncomeJournalEntry(income.id))?.created) reversed++
    }
  }
  for (const expense of expenses) {
    if (expense.status === "VALIDATED") {
      if ((await postExpenseToJournal(expense.id))?.created) posted++
    } else {
      if ((await reverseExpenseJournalEntry(expense.id))?.created) reversed++
    }
  }
  return { posted, reversed }
}
