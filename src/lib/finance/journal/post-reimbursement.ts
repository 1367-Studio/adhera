// src/lib/finance/journal/post-reimbursement.ts
// FORM-93 — ties the ReimbursementRequest workflow into the double-entry ledger, following two
// different timing rules depending on Association.accountingRegime:
//   - ACCRUAL: the charge is recognized at approval (debit the category account, credit the
//     requester's own 467 "dû au bénévole" account); reimbursement later just settles that 467
//     against tresorerie — no new Expense at that point, same "settle a recognized liability"
//     shape as post-facture-recue-payment.ts's postFactureRecuePaymentToJournal.
//   - CASH: the charge is recognized only when the reimbursement is actually paid — debit the
//     category account, credit tresorerie directly, same two-line shape postExpenseToJournal
//     already uses for a plain Expense.
// Either way, each ReimbursementItem materializes its own single-category Expense row (linked
// via ReimbursementItem.expenseId) so existing reports that read Expense directly
// (income-statement.ts, budget.ts) see the reimbursed charge without any changes on their side.
import { prisma } from "@/lib/prisma/client"
import { postJournalEntry } from "@/lib/finance/journal/post-journal-entry"
import { ensureChartAccounts, resolveChartAccountByCode, ensurePersonLiabilityAccount } from "@/lib/finance/journal/chart-accounts-seed"
import { resolveTresorerieAccount, COMPTE_ATTENTE_CODE, reverseExpenseJournalEntry } from "@/lib/finance/journal/post-income-expense"
import { resolveExerciceForDate } from "@/lib/finance/exercice"

async function resolveExerciceId(associationId: string, date: Date): Promise<string | null> {
  const exercice = await resolveExerciceForDate(associationId, date)
  return exercice?.id ?? null
}

type ReimbursementItemForMaterialize = {
  id: string; date: Date; description: string; amount: unknown; categoryId: string; receiptUrl: string
  isImmobilisation: boolean
}

// Materializes one item's Expense and atomically claims it via a compare-and-swap on
// expenseId (the WHERE clause only matches while it's still null — Postgres guarantees only
// one concurrent UPDATE can win that race for a given row). Without this, two near-simultaneous
// calls to postReimbursementApproval/postReimbursementSettlement for the same request (two open
// tabs, a network retry, a direct API call — the client's own loading-disables-the-button guard
// only covers the normal single-click path) could each create their own Expense for the same
// item and both post a journal entry, double-recognizing the charge. Returns null if this call
// lost the race — the caller must not post a journal entry for a null result.
async function materializeAndClaimExpense(
  associationId: string, exerciceId: string, item: ReimbursementItemForMaterialize, date: Date,
): Promise<{ id: string } | null> {
  const expense = await prisma.expense.create({
    data: {
      associationId,
      exerciceId,
      amount:      item.amount as never,
      categoryId:  item.categoryId,
      date,
      description: item.description,
      receiptUrl:  item.receiptUrl,
      status:      "VALIDATED",
      isImmobilisation: item.isImmobilisation,
    },
  })
  const claim = await prisma.reimbursementItem.updateMany({
    where: { id: item.id, expenseId: null },
    data:  { expenseId: expense.id },
  })
  if (claim.count === 0) {
    // Lost the race — another concurrent call already materialized this item. Cancel our
    // extra Expense instead of leaving an orphan sitting around unposted.
    await prisma.expense.update({ where: { id: expense.id }, data: { status: "CANCELLED" } })
    return null
  }
  return { id: expense.id }
}

// ACCRUAL regime only — called right after a request moves to APPROVED. Materializes each
// item's Expense and posts its charge against the requester's 467 account. Safe to call more
// than once (e.g. from the catch-up below): items that already have an expenseId are skipped,
// and postJournalEntry's own idempotencyKey guard covers the rest.
export async function postReimbursementApproval(requestId: string): Promise<void> {
  const request = await prisma.reimbursementRequest.findUnique({
    where:   { id: requestId },
    include: { items: { include: { category: true } } },
  })
  if (!request || request.status !== "APPROVED") return

  const association = await prisma.association.findUnique({
    where:  { id: request.associationId },
    select: { accountingRegime: true },
  })
  if (association?.accountingRegime !== "ACCRUAL") return // CASH regime posts at reimbursement, not here

  await ensureChartAccounts(request.associationId)
  const personAccount = await ensurePersonLiabilityAccount(request.associationId, request.requesterId)

  for (const item of request.items) {
    if (item.expenseId) continue

    const exerciceId = await resolveExerciceId(request.associationId, item.date)
    if (!exerciceId) continue // left for ensurePostedReimbursementJournalEntries's catch-up

    const categoryAccount = await resolveChartAccountByCode(request.associationId, item.category.accountingCode)
    if (!categoryAccount) continue

    const expense = await materializeAndClaimExpense(request.associationId, exerciceId, item, item.date)
    if (!expense) continue

    const amount = Number(item.amount)
    await postJournalEntry({
      associationId:  request.associationId,
      exerciceId,
      date:           item.date,
      label:          item.description || categoryAccount.label,
      sourceType:     "EXPENSE",
      idempotencyKey: `expense:${expense.id}`,
      expenseId:      expense.id,
      lines: [
        { chartAccountId: categoryAccount.id, debit:  amount, label: categoryAccount.label },
        { chartAccountId: personAccount.id,   credit: amount, label: "Dû au bénévole" },
      ],
    })
  }
}

// Called right after a Reimbursement payment is registered. Branches on the association's
// accounting regime — see this module's own doc comment above for the shape of each branch.
export async function postReimbursementSettlement(reimbursementId: string): Promise<void> {
  const reimbursement = await prisma.reimbursement.findUnique({
    where:   { id: reimbursementId },
    include: { request: { include: { items: { include: { category: true } } } } },
  })
  if (!reimbursement) return

  const association = await prisma.association.findUnique({
    where:  { id: reimbursement.associationId },
    select: { accountingRegime: true },
  })

  await ensureChartAccounts(reimbursement.associationId)
  const tresorerieAccount = await resolveTresorerieAccount(
    reimbursement.associationId, reimbursement.paymentMethod, reimbursement.bankAccountId, COMPTE_ATTENTE_CODE,
  )
  if (!tresorerieAccount) return

  if (association?.accountingRegime === "ACCRUAL") {
    // The charge was already recognized at approval — this only settles the requester's 467
    // liability against tresorerie. Never creates a second Expense.
    const personAccount = await ensurePersonLiabilityAccount(reimbursement.associationId, reimbursement.request.requesterId)
    const exerciceId = await resolveExerciceId(reimbursement.associationId, reimbursement.date)
    if (!exerciceId) return

    const amount = Number(reimbursement.request.totalAmount)
    await postJournalEntry({
      associationId:  reimbursement.associationId,
      exerciceId,
      date:           reimbursement.date,
      label:          `Remboursement de frais — ${reimbursement.request.subject}`,
      sourceType:     "REIMBURSEMENT_SETTLEMENT",
      idempotencyKey: `reimbursement:${reimbursement.id}:settlement`,
      reimbursementRequestId: reimbursement.request.id,
      lines: [
        { chartAccountId: personAccount.id,     debit:  amount, label: "Dû au bénévole" },
        { chartAccountId: tresorerieAccount.id, credit: amount, label: "Décaissement" },
      ],
    })
    return
  }

  // CASH regime: nothing was recognized at approval — each item's charge is recognized now,
  // against tresorerie directly. Deliberately posted on reimbursement.date, not item.date:
  // cash-basis recognizes a charge when cash actually moves, not when it was incurred.
  for (const item of reimbursement.request.items) {
    if (item.expenseId) continue

    const categoryAccount = await resolveChartAccountByCode(reimbursement.associationId, item.category.accountingCode)
    if (!categoryAccount) continue

    const exerciceId = await resolveExerciceId(reimbursement.associationId, reimbursement.date)
    if (!exerciceId) continue

    const expense = await materializeAndClaimExpense(reimbursement.associationId, exerciceId, item, reimbursement.date)
    if (!expense) continue

    const amount = Number(item.amount)
    await postJournalEntry({
      associationId:  reimbursement.associationId,
      exerciceId,
      date:           reimbursement.date,
      label:          item.description || categoryAccount.label,
      sourceType:     "EXPENSE",
      idempotencyKey: `expense:${expense.id}`,
      expenseId:      expense.id,
      lines: [
        { chartAccountId: categoryAccount.id,   debit:  amount, label: categoryAccount.label },
        { chartAccountId: tresorerieAccount.id, credit: amount, label: "Décaissement" },
      ],
    })
  }
}

// Authorized post-approval cancellation (ACCRUAL regime, before reimbursement) — reverses every
// materialized item's journal entry via the existing, unmodified reverseExpenseJournalEntry
// (works as-is: it only needs the shared "expense:<id>" idempotency-key convention, which these
// entries already follow) and flips each Expense to CANCELLED. CASH-regime requests never post
// anything before reimbursement, so there's nothing to reverse here for them.
export async function reverseReimbursementApproval(requestId: string): Promise<void> {
  const items = await prisma.reimbursementItem.findMany({
    where: { reimbursementRequestId: requestId, expenseId: { not: null } },
  })
  for (const item of items) {
    if (!item.expenseId) continue
    await reverseExpenseJournalEntry(item.expenseId)
    await prisma.expense.update({ where: { id: item.expenseId }, data: { status: "CANCELLED" } })
  }
}

// Lazy catch-up for APPROVED (ACCRUAL regime) requests whose item(s) had no exercice covering
// their date at approval time — same posture as ensurePostedJournalEntries. Called from the
// same controlled points (exercice-closing route, a backfill script), never from a request hot
// path: re-running postReimbursementApproval per request is safe (it skips items that already
// have an expenseId).
export async function ensurePostedReimbursementJournalEntries(associationId: string): Promise<{ posted: number }> {
  const pendingItems = await prisma.reimbursementItem.findMany({
    where: { expenseId: null, request: { associationId, status: "APPROVED" } },
    select: { reimbursementRequestId: true },
  })
  const requestIds = Array.from(new Set(pendingItems.map(i => i.reimbursementRequestId)))

  let posted = 0
  for (const requestId of requestIds) {
    const before = await prisma.reimbursementItem.count({ where: { reimbursementRequestId: requestId, expenseId: null } })
    await postReimbursementApproval(requestId)
    const after = await prisma.reimbursementItem.count({ where: { reimbursementRequestId: requestId, expenseId: null } })
    posted += before - after
  }
  return { posted }
}
