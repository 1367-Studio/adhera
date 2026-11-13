// src/lib/finance/journal/post-facture-recue-payment.ts
// FORM-107 Fase 3 — the two postings specific to a FactureRecue linked to an Immobilisation
// (Immobilisation.factureRecueId). A FactureRecue NOT linked to one never reaches this module:
// each of its payments creates a plain categoryless Expense instead (see
// factures-recues/[id]/payments/route.ts), going through the existing generic
// postExpenseToJournal — or rather, not: that Expense still has no category, so (same
// pre-existing gap as before Fase 3) it isn't posted to the journal either. Out of scope here.
import { prisma } from "@/lib/prisma/client"
import { postJournalEntry, type PostJournalEntryResult } from "@/lib/finance/journal/post-journal-entry"
import { resolveChartAccountByCode } from "@/lib/finance/journal/chart-accounts-seed"
import { resolveTresorerieAccount, COMPTE_ATTENTE_CODE } from "@/lib/finance/journal/post-income-expense"

const DETTES_IMMOBILISATIONS_CODE = "404000"

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

  const exerciceId = await resolveExerciceId(immobilisation.associationId, immobilisation.factureRecue.issueDate).catch(() => null)
  if (!exerciceId) return null

  const amount = Number(immobilisation.entryValue)
  return postJournalEntry({
    associationId:    immobilisation.associationId,
    exerciceId,
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

async function resolveExerciceId(associationId: string, date: Date): Promise<string> {
  const exercice = await prisma.exerciceComptable.findFirst({
    where: { associationId, startDate: { lte: date }, endDate: { gte: date } },
  })
  if (!exercice) throw new Error(`postImmobilisationAcquisition: no exercice covers ${date.toISOString()} for association ${associationId}`)
  return exercice.id
}

// Settles part (or all) of the 404000 debt a FactureRecuePayment pays down — debit 404000,
// credit tesouraria (reconciled bank account if one exists, else cash/suspense — same
// resolution as post-income-expense.ts). No Expense is created for this: the charge/asset was
// already recognized at acquisition, paying the invoice only moves money and settles a
// liability, it doesn't recognize a new charge.
export async function postFactureRecuePaymentToJournal(paymentId: string): Promise<PostJournalEntryResult | null> {
  const payment = await prisma.factureRecuePayment.findUnique({
    where:   { id: paymentId },
    include: { factureRecue: { include: { immobilisation: true } } },
  })
  if (!payment || !payment.factureRecue.immobilisation) return null

  const associationId = payment.factureRecue.associationId
  const exerciceId = await resolveExerciceId(associationId, payment.paidAt).catch(() => null)
  if (!exerciceId) return null

  const dettesAccount = await resolveChartAccountByCode(associationId, DETTES_IMMOBILISATIONS_CODE)
  if (!dettesAccount) return null
  const tresorerieAccount = await resolveTresorerieAccount(associationId, payment.method, null, COMPTE_ATTENTE_CODE)
  if (!tresorerieAccount) return null

  const amount = Number(payment.amount)
  return postJournalEntry({
    associationId,
    exerciceId,
    date:           payment.paidAt,
    label:          `Règlement — ${payment.factureRecue.immobilisation.label}`,
    sourceType:     "FACTURE_RECUE_PAYMENT",
    idempotencyKey: `facture-recue-payment:${payment.id}`,
    factureRecuePaymentId: payment.id,
    lines: [
      { chartAccountId: dettesAccount.id,     debit:  amount, label: "Fournisseurs d'immobilisations" },
      { chartAccountId: tresorerieAccount.id, credit: amount, label: "Décaissement" },
    ],
  })
}
