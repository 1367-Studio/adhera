// src/lib/finance/immobilisations/post-closing-depreciation.ts
// Posts one exercice's dotation for every eligible Immobilisation of an association — called
// from the exercice-closing route, BEFORE generateOpeningBalanceForExercice (FORM-107 Fase 2).
// That order matters: the dotation must land inside the CLOSING exercice's own journal (it's
// what reduces that exercice's own result) so the opening-balance calculation — which sums
// every JournalLine up to and including the closing exercice's endDate — picks it up and
// correctly folds it into the "Résultat de l'exercice" carried into the next exercice's Passif.
import { prisma } from "@/lib/prisma/client"
import { postJournalEntry } from "@/lib/finance/journal/post-journal-entry"
import { resolveChartAccountByCode } from "@/lib/finance/journal/chart-accounts-seed"
import { computeDotationCents } from "@/lib/finance/immobilisations/compute-depreciation"

export async function generateDepreciationForExercice(
  associationId: string,
  exerciceId:    string,
): Promise<{ posted: number }> {
  const exercice = await prisma.exerciceComptable.findUnique({ where: { id: exerciceId } })
  if (!exercice) return { posted: 0 }

  const assets = await prisma.immobilisation.findMany({
    where: {
      associationId,
      usageStartDate: { lte: exercice.endDate },
      OR: [{ disposalDate: null }, { disposalDate: { gte: exercice.startDate } }],
    },
  })

  let posted = 0
  for (const asset of assets) {
    const latestPrior = await prisma.immobilisationDepreciation.findFirst({
      where:   { immobilisationId: asset.id, exercice: { startDate: { lt: exercice.startDate } } },
      orderBy: { exercice: { startDate: "desc" } },
    })
    const cumulativeBeforeCents = latestPrior ? Math.round(Number(latestPrior.accumulatedAfter) * 100) : 0
    const entryValueCents       = Math.round(Number(asset.entryValue) * 100)

    const dotationCents = computeDotationCents(
      {
        entryValueCents,
        residualValueCents: Math.round(Number(asset.residualValue) * 100),
        usageStartDate:      asset.usageStartDate,
        usefulLifeMonths:    asset.usefulLifeMonths,
        disposalDate:        asset.disposalDate,
      },
      { startDate: exercice.startDate, endDate: exercice.endDate },
      cumulativeBeforeCents,
    )
    if (dotationCents <= 0) continue

    const [expenseAccount, depreciationAccount] = await Promise.all([
      resolveChartAccountByCode(associationId, asset.expenseAccountCode),
      resolveChartAccountByCode(associationId, asset.depreciationAccountCode),
    ])
    // Chart not seeded for this association yet — skip; ensureChartAccounts runs right before
    // this in the closing route, so this is only reachable if that call itself failed.
    if (!expenseAccount || !depreciationAccount) continue

    const idempotencyKey = `immobilisation:${asset.id}:depreciation:${exerciceId}`
    const result = await postJournalEntry({
      associationId,
      exerciceId,
      date:           exercice.endDate,
      label:          `Dotation aux amortissements — ${asset.label}`,
      sourceType:     "IMMOBILISATION_DEPRECIATION",
      idempotencyKey,
      lines: [
        { chartAccountId: expenseAccount.id,      debit:  dotationCents / 100, label: asset.label },
        { chartAccountId: depreciationAccount.id, credit: dotationCents / 100, label: asset.label },
      ],
    })
    // Already posted by a prior run — its ImmobilisationDepreciation row already exists too
    // (same idempotencyKey -> same journalEntryId -> the @@unique on immobilisationId+exerciceId
    // would already have a row pointing at it), nothing left to do.
    if (!result.created) continue

    const accumulatedAfterCents = cumulativeBeforeCents + dotationCents
    await prisma.immobilisationDepreciation.create({
      data: {
        immobilisationId: asset.id,
        exerciceId,
        dotationAmount:   dotationCents / 100,
        accumulatedAfter: accumulatedAfterCents / 100,
        netValueAfter:     (entryValueCents - accumulatedAfterCents) / 100,
        journalEntryId:    result.journalEntry.id,
      },
    })
    posted++
  }

  return { posted }
}

// The other half of the Fase 1 opening-balance exception: undoes the dotation(s) a fechamento
// posted into the exercice being reopened — same posture, only safe because it compensates an
// administrative action being reversed (see opening-balance.ts's deleteOpeningBalanceForExercice
// doc comment for the full reasoning).
export async function deleteDepreciationForExercice(exerciceId: string): Promise<number> {
  const rows = await prisma.immobilisationDepreciation.findMany({ where: { exerciceId } })
  for (const row of rows) {
    await prisma.immobilisationDepreciation.delete({ where: { id: row.id } })
    await prisma.journalEntry.delete({ where: { id: row.journalEntryId } })
  }
  return rows.length
}
