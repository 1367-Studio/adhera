// src/lib/finance/journal/post-facture-recue-payment.ts
// FORM-107 Fase 3 — the two postings specific to a FactureRecue linked to an Immobilisation
// (Immobilisation.factureRecueId): postImmobilisationAcquisition/postFactureRecuePaymentToJournal
// below, settling 404000 "Fournisseurs d'immobilisations".
//
// FORM-117 — a plain (non-Immobilisation) FactureRecue can now reach the journal too, following
// the same "recognize a charge now, settle a liability later" shape as post-reimbursement.ts,
// gated on Association.accountingRegime:
//   - ACCRUAL: postFactureRecueCharge recognizes the charge at registration (debit the chosen
//     category account, credit 401000 "Fournisseurs"); postFactureRecuePaymentToJournal then
//     just settles 401000 against tresorerie on each payment, same as the Immobilisation case.
//   - CASH: nothing is posted here — the legacy per-payment categoryless Expense path in
//     factures-recues/[id]/payments/route.ts stays in charge, now carrying the chosen category
//     (if any) so the existing, unmodified postExpenseToJournal/ensurePostedJournalEntries
//     catch-up can post it on its own.
// A FactureRecue with no categoryId at all keeps today's exact behavior either way — this is the
// pre-existing, documented gap, unchanged for anyone who doesn't categorize their invoices.
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { postJournalEntry, type PostJournalEntryResult } from "@/lib/finance/journal/post-journal-entry"
import { ensureChartAccounts, resolveChartAccountByCode } from "@/lib/finance/journal/chart-accounts-seed"
import { resolveTresorerieAccount, COMPTE_ATTENTE_CODE } from "@/lib/finance/journal/post-income-expense"
import { resolveExerciceForDate } from "@/lib/finance/exercice"
import { factureRecueExpenseDescription } from "@/lib/facture-recue"

const DETTES_IMMOBILISATIONS_CODE = "404000"
const DETTES_FOURNISSEURS_CODE    = "401000"

// Posts the ONE acquisition entry for a FactureRecue-origin Immobilisation: debit the asset
// account for the full invoice amount, credit 404000 (Fournisseurs d'immobilisations) — the
// debt sits there, regardless of how much has actually been paid, until payments settle it
// (see postFactureRecuePaymentToJournal below). Called once, right after the Immobilisation
// row is created with factureRecueId set.
export async function postImmobilisationAcquisition(immobilisationId: string): Promise<PostJournalEntryResult | null> {
  const immobilisation = await prisma.immobilisation.findUnique({
    where:   { id: immobilisationId },
    include: { factureRecue: true },
  })
  if (!immobilisation || !immobilisation.factureRecue) return null

  const [assetAccount, dettesAccount] = await Promise.all([
    resolveChartAccountByCode(immobilisation.associationId, immobilisation.assetAccountCode),
    resolveChartAccountByCode(immobilisation.associationId, DETTES_IMMOBILISATIONS_CODE),
  ])
  if (!assetAccount || !dettesAccount) return null

  const exercice = await resolveExerciceForDate(immobilisation.associationId, immobilisation.factureRecue.issueDate)
  if (!exercice) return null

  const amount = Number(immobilisation.entryValue)
  return postJournalEntry({
    associationId:    immobilisation.associationId,
    exerciceId:       exercice.id,
    date:             immobilisation.factureRecue.issueDate,
    label:            `Acquisition — ${immobilisation.label}`,
    sourceType:       "IMMOBILISATION_ACQUISITION",
    idempotencyKey:   `immobilisation:${immobilisation.id}:acquisition`,
    immobilisationId: immobilisation.id,
    lines: [
      { chartAccountId: assetAccount.id,  debit:  amount, label: immobilisation.label },
      { chartAccountId: dettesAccount.id, credit: amount, label: "Fournisseurs d'immobilisations" },
    ],
  })
}

// FORM-117 — recognizes the accrual charge of a plain, categorized FactureRecue under ACCRUAL
// regime: debit the chosen category account, credit 401000 "Fournisseurs" for the full invoice
// amount. Materializes the one backing Expense (Expense.factureRecueId) that income-statement.ts
// and every other report already reads directly, so the charge shows up everywhere an ordinary
// Expense would, with no changes on the reading side. Safe to call more than once (e.g. from the
// catch-up below, or a retried request): no-ops once factureRecue.expense already exists, and a
// concurrent racing call loses on the new unique Expense.factureRecueId constraint instead of
// double-creating.
export async function postFactureRecueCharge(factureRecueId: string): Promise<PostJournalEntryResult | null> {
  const factureRecue = await prisma.factureRecue.findUnique({
    where:   { id: factureRecueId },
    include: {
      immobilisation: { select: { id: true } },
      category:       true,
      expense:        { select: { id: true } },
      fournisseur:    { select: { companyName: true } },
      association:    { select: { accountingRegime: true } },
      // If a payment already landed (because no exercice covered issueDate yet when this was
      // first attempted, and the catch-up is only now getting to it), the payments route
      // already recognized the charge the legacy way — see its own hasAccrualCharge comment.
      // Posting the accrual charge here too would double-recognize it. Once any payment has
      // landed, this invoice stays on the legacy per-payment path for its whole lifetime.
      payments:       { select: { id: true }, take: 1 },
    },
  })
  if (!factureRecue || factureRecue.immobilisation || !factureRecue.categoryId || factureRecue.expense) return null
  if (factureRecue.payments.length > 0) return null
  if (factureRecue.association.accountingRegime !== "ACCRUAL") return null

  const exercice = await resolveExerciceForDate(factureRecue.associationId, factureRecue.issueDate)
  if (!exercice) return null // left for ensurePostedFactureRecueJournalEntries's catch-up

  await ensureChartAccounts(factureRecue.associationId)
  const [categoryAccount, dettesAccount] = await Promise.all([
    resolveChartAccountByCode(factureRecue.associationId, factureRecue.category!.accountingCode),
    resolveChartAccountByCode(factureRecue.associationId, DETTES_FOURNISSEURS_CODE),
  ])
  if (!categoryAccount || !dettesAccount) return null

  let expenseId: string
  try {
    const expense = await prisma.expense.create({
      data: {
        associationId: factureRecue.associationId,
        exerciceId:     exercice.id,
        factureRecueId: factureRecue.id,
        categoryId:     factureRecue.categoryId,
        amount:         factureRecue.amount,
        status:         "VALIDATED",
        date:           factureRecue.issueDate,
        vendor:         factureRecue.fournisseur?.companyName ?? null,
        description:    factureRecueExpenseDescription(factureRecue),
      },
    })
    expenseId = expense.id
  } catch (err) {
    // P2002 on the unique Expense.factureRecueId — a concurrent caller already materialized
    // this charge between our read above and this write. Same race, same resolution as
    // post-journal-entry.ts's own idempotencyKey guard: the loser just no-ops.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return null
    throw err
  }

  const amount = Number(factureRecue.amount)
  return postJournalEntry({
    associationId:  factureRecue.associationId,
    exerciceId:     exercice.id,
    date:           factureRecue.issueDate,
    label:          factureRecueExpenseDescription(factureRecue),
    sourceType:     "EXPENSE",
    idempotencyKey: `expense:${expenseId}`,
    expenseId,
    lines: [
      { chartAccountId: categoryAccount.id, debit:  amount, label: categoryAccount.label },
      { chartAccountId: dettesAccount.id,   credit: amount, label: "Fournisseurs" },
    ],
  })
}

// Settles part (or all) of the debt a FactureRecuePayment pays down — debit the payable account,
// credit tesouraria (reconciled bank account if one exists, else cash/suspense — same resolution
// as post-income-expense.ts). No Expense is created for this: the charge/asset was already
// recognized at acquisition, paying the invoice only moves money and settles a liability, it
// doesn't recognize a new charge. Branches on which payable account applies: 404000 for an
// Immobilisation-linked invoice (unchanged), 401000 for a plain categorized invoice under ACCRUAL
// regime (FORM-117); anything else returns null (the legacy per-payment Expense path handles it).
export async function postFactureRecuePaymentToJournal(paymentId: string): Promise<PostJournalEntryResult | null> {
  const payment = await prisma.factureRecuePayment.findUnique({
    where:   { id: paymentId },
    include: {
      factureRecue: {
        include: { immobilisation: true, association: { select: { accountingRegime: true } } },
      },
    },
  })
  if (!payment) return null

  const { factureRecue } = payment
  const associationId = factureRecue.associationId

  let dettesCode: string
  let dettesLabel: string
  if (factureRecue.immobilisation) {
    dettesCode  = DETTES_IMMOBILISATIONS_CODE
    dettesLabel = "Fournisseurs d'immobilisations"
  } else if (factureRecue.categoryId && factureRecue.association.accountingRegime === "ACCRUAL") {
    dettesCode  = DETTES_FOURNISSEURS_CODE
    dettesLabel = "Fournisseurs"
  } else {
    return null
  }

  const exercice = await resolveExerciceForDate(associationId, payment.paidAt)
  if (!exercice) return null

  const dettesAccount = await resolveChartAccountByCode(associationId, dettesCode)
  if (!dettesAccount) return null
  const tresorerieAccount = await resolveTresorerieAccount(associationId, payment.method, null, COMPTE_ATTENTE_CODE)
  if (!tresorerieAccount) return null

  const amount = Number(payment.amount)
  return postJournalEntry({
    associationId,
    exerciceId:     exercice.id,
    date:           payment.paidAt,
    label:          `Règlement — ${factureRecueExpenseDescription(factureRecue)}`,
    sourceType:     "FACTURE_RECUE_PAYMENT",
    idempotencyKey: `facture-recue-payment:${payment.id}`,
    factureRecuePaymentId: payment.id,
    lines: [
      { chartAccountId: dettesAccount.id,     debit:  amount, label: dettesLabel },
      { chartAccountId: tresorerieAccount.id, credit: amount, label: "Décaissement" },
    ],
  })
}

// Lazy catch-up for plain categorized invoices whose issueDate had no covering exercice at
// registration time — same posture as ensurePostedReimbursementJournalEntries, except this one
// is actually wired in (see exercices/[id]/route.ts and rapports/bilan/refresh/route.ts), not
// left dead. Re-running postFactureRecueCharge per invoice is safe: it skips any that already
// have an accrual Expense.
export async function ensurePostedFactureRecueJournalEntries(associationId: string): Promise<{ posted: number }> {
  const pending = await prisma.factureRecue.findMany({
    where:  { associationId, categoryId: { not: null }, expense: null, immobilisation: null, deletedAt: null },
    select: { id: true },
  })

  let posted = 0
  for (const { id } of pending) {
    const result = await postFactureRecueCharge(id)
    if (result?.created) posted += 1
  }
  return { posted }
}
