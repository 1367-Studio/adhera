// src/lib/finance/journal/post-journal-entry.ts
// The single place in the whole project allowed to write JournalEntry/JournalLine rows —
// see FORM-107 Fase 1. Every other journal/* module (post-income-expense, opening-balance,
// future Immobilisations/Factures postings) calls this instead of touching prisma.journalEntry
// directly, so "every posted entry balances" and "idempotency is enforced" can never be
// bypassed by a call site that forgot to check first.
import { prisma } from "@/lib/prisma/client"
import { Prisma } from "@prisma/client"
import type { JournalSourceType } from "@prisma/client"

export interface PostJournalEntryLine {
  chartAccountId: string
  debit?:  number
  credit?: number
  label?:  string
}

export interface PostJournalEntryInput {
  associationId:     string
  exerciceId:         string
  date:               Date
  label:              string
  sourceType:         JournalSourceType
  // Deterministic — e.g. "income:<id>", "income:<id>:reversal", "opening-balance:<exerciceId>".
  // The ONLY thing that makes re-running a backfill or replaying a webhook safe.
  idempotencyKey:     string
  createdByUserId?:   string | null
  incomeId?:          string | null
  expenseId?:         string | null
  bankTransactionId?: string | null
  accountTransferId?: string | null
  // FORM-107 Fase 3
  factureRecuePaymentId?: string | null
  immobilisationId?:      string | null
  lines:              PostJournalEntryLine[]
}

export interface PostJournalEntryResult {
  created:      boolean // false means idempotencyKey already existed — nothing new was written
  journalEntry: Prisma.JournalEntryGetPayload<{ include: { lines: true } }>
}

export class UnbalancedJournalEntryError extends Error {}

// Cents, not the raw Decimal/number, to compare debit vs credit totals without floating-point
// drift — same convention as refundCents elsewhere in src/app/api/boutique/commandes/[id]/
// refund/route.ts.
function centsOf(amount: number | undefined): number {
  return Math.round((amount ?? 0) * 100)
}

export async function postJournalEntry(input: PostJournalEntryInput): Promise<PostJournalEntryResult> {
  const existing = await prisma.journalEntry.findUnique({
    where:   { idempotencyKey: input.idempotencyKey },
    include: { lines: true },
  })
  if (existing) return { created: false, journalEntry: existing }

  if (input.lines.length < 2) {
    throw new Error(`postJournalEntry: entry "${input.idempotencyKey}" needs at least two lines, got ${input.lines.length}`)
  }

  const totalDebitCents  = input.lines.reduce((sum, l) => sum + centsOf(l.debit),  0)
  const totalCreditCents = input.lines.reduce((sum, l) => sum + centsOf(l.credit), 0)
  if (totalDebitCents !== totalCreditCents) {
    throw new UnbalancedJournalEntryError(
      `postJournalEntry: entry "${input.idempotencyKey}" is unbalanced — debit ${totalDebitCents / 100} ≠ credit ${totalCreditCents / 100}`,
    )
  }
  if (totalDebitCents === 0) {
    throw new Error(`postJournalEntry: entry "${input.idempotencyKey}" totals zero — refuse to post a no-op entry`)
  }

  try {
    const journalEntry = await prisma.journalEntry.create({
      data: {
        associationId:     input.associationId,
        exerciceId:        input.exerciceId,
        date:              input.date,
        label:             input.label,
        sourceType:        input.sourceType,
        idempotencyKey:    input.idempotencyKey,
        createdByUserId:   input.createdByUserId ?? null,
        incomeId:          input.incomeId ?? null,
        expenseId:         input.expenseId ?? null,
        bankTransactionId: input.bankTransactionId ?? null,
        accountTransferId: input.accountTransferId ?? null,
        factureRecuePaymentId: input.factureRecuePaymentId ?? null,
        immobilisationId:      input.immobilisationId ?? null,
        lines: {
          create: input.lines.map((l, order) => ({
            chartAccountId: l.chartAccountId,
            debit:          l.debit ?? 0,
            credit:         l.credit ?? 0,
            label:          l.label,
            order,
          })),
        },
      },
      include: { lines: true },
    })
    return { created: true, journalEntry }
  } catch (err) {
    // P2002 on idempotencyKey — a concurrent caller posted the exact same entry between our
    // read above and this write (e.g. two requests racing on the same Stripe webhook
    // redelivery). The unique constraint is the real guard; this just turns the loser's crash
    // into the same clean no-op the read above would have produced had it won the race.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const concurrent = await prisma.journalEntry.findUnique({
        where:   { idempotencyKey: input.idempotencyKey },
        include: { lines: true },
      })
      if (concurrent) return { created: false, journalEntry: concurrent }
    }
    throw err
  }
}
