// src/lib/finance/journal/chart-accounts-seed.ts
// Find-or-create the real ledger (ChartAccount rows) an association needs before any
// JournalEntry can be posted — see FORM-107 Fase 1. Mirrors ensureDefaultFinanceCategories's
// shape (find-or-create by a stable key, never touch an account the association already has),
// but the "key" here is the PCG `code`, not FinanceCategory.key.
import { prisma } from "@/lib/prisma/client"
import { REFERENCE_ACCOUNTS, LEDGER_INFRASTRUCTURE_ACCOUNTS } from "@/lib/finance/chart-of-accounts"

export interface ChartAccountSeedResult {
  createdReferenceAccounts: number
  createdInfrastructureAccounts: number
  createdBankAccounts: number
}

// Ensures every REFERENCE_ACCOUNTS/LEDGER_INFRASTRUCTURE_ACCOUNTS code, plus one 512xxx
// account per active BankAccount, exists as a real ChartAccount row for this association.
// Safe to call repeatedly (e.g. before every journal posting) — only ever creates rows that
// are missing, never touches or recreates an existing one (so a manually-archived account
// stays archived).
export async function ensureChartAccounts(associationId: string): Promise<ChartAccountSeedResult> {
  const existing = await prisma.chartAccount.findMany({
    where:  { associationId },
    select: { code: true, bankAccountId: true },
  })
  const existingCodes = new Set(existing.map(a => a.code))

  const referenceToCreate = REFERENCE_ACCOUNTS.filter(a => !existingCodes.has(a.code))
  const infrastructureToCreate = LEDGER_INFRASTRUCTURE_ACCOUNTS.filter(a => !existingCodes.has(a.code))

  if (referenceToCreate.length > 0 || infrastructureToCreate.length > 0) {
    await prisma.chartAccount.createMany({
      // skipDuplicates — same reasoning as ensureDefaultFinanceCategories: a race between two
      // calls (e.g. two Income rows paid concurrently, each triggering a seed) must not fail
      // the whole batch over one row the other call already created.
      skipDuplicates: true,
      data: [
        ...referenceToCreate.map(a => ({
          associationId, code: a.code, label: a.label, nature: a.nature, normalSide: a.normalSide, isSystem: true,
        })),
        ...infrastructureToCreate.map(a => ({
          associationId, code: a.code, label: a.label, nature: a.nature, normalSide: a.normalSide, isSystem: true,
        })),
      ],
    })
  }

  // One 512xxx account per BankAccount — linked by bankAccountId, not matched by code, so a
  // closed/reopened or renamed bank account never loses its ledger history. Numbered by
  // creation order per association ("512001", "512002", …) purely for a readable account
  // number; the real identity is the bankAccountId link, not the digits.
  const existingBankAccountIds = new Set(existing.map(a => a.bankAccountId).filter((id): id is string => id !== null))
  const bankAccounts = await prisma.bankAccount.findMany({
    where:   { associationId },
    select:  { id: true, bankName: true, accountName: true },
    orderBy: { createdAt: "asc" },
  })
  const missingBankAccounts = bankAccounts.filter(b => !existingBankAccountIds.has(b.id))

  let createdBankAccounts = 0
  if (missingBankAccounts.length > 0) {
    // Sequential suffix continues after every already-seeded bank account, so re-running this
    // after a new BankAccount was added never reuses a digit a prior seed already assigned.
    let nextSeq = existingBankAccountIds.size + 1
    for (const bankAccount of missingBankAccounts) {
      const code = `512${String(nextSeq).padStart(3, "0")}`
      await prisma.chartAccount.create({
        data: {
          associationId,
          code,
          label:      `${bankAccount.bankName} — ${bankAccount.accountName}`,
          nature:     "ACTIF",
          normalSide: "DEBIT",
          isSystem:   true,
          bankAccountId: bankAccount.id,
        },
      })
      nextSeq += 1
      createdBankAccounts += 1
    }
  }

  return {
    createdReferenceAccounts: referenceToCreate.length,
    createdInfrastructureAccounts: infrastructureToCreate.length,
    createdBankAccounts,
  }
}

// Resolves the ChartAccount a FinanceCategory's accountingCode should post against. Returns
// null if the category has no accountingCode or the code isn't in the controlled list (the
// category form already enforces this at creation time — a null here on an old row signals a
// legacy category that predates that enforcement and needs manual remediation, not a silent
// guess).
export async function resolveChartAccountByCode(associationId: string, code: string | null | undefined) {
  if (!code) return null
  return prisma.chartAccount.findUnique({
    where: { associationId_code: { associationId, code } },
  })
}
