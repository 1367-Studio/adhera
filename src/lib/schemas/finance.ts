import { z } from "zod"

export const bankAccountSchema = z.object({
  bankName:       z.string().trim().min(1, "Nom de la banque requis"),
  accountName:    z.string().trim().min(1, "Nom du compte requis"),
  ibanLast4:      z.string().trim().max(4).optional().or(z.literal("")),
  currency:       z.string().default("EUR"),
  openingBalance: z.number().default(0),
  isActive:       z.boolean().default(true),
})

export const bankAccountUpdateSchema = bankAccountSchema.partial()

export type BankAccountInput       = z.infer<typeof bankAccountSchema>
export type BankAccountUpdateInput = z.infer<typeof bankAccountUpdateSchema>

export const financeCategorySchema = z.object({
  name:          z.string().trim().min(1, "Nom requis"),
  type:          z.enum(["INCOME", "EXPENSE"]),
  accountingCode: z.string().trim().optional().or(z.literal("")),
})

export const financeCategoryUpdateSchema = financeCategorySchema.partial()

export type FinanceCategoryInput       = z.infer<typeof financeCategorySchema>
export type FinanceCategoryUpdateInput = z.infer<typeof financeCategoryUpdateSchema>

export const incomeSchema = z.object({
  amount:        z.number().positive("Montant doit être positif"),
  categoryId:    z.string().optional().or(z.literal("")),
  memberId:      z.string().optional().or(z.literal("")),
  paymentMethod: z.string().optional().or(z.literal("")),
  date:          z.string().min(1, "Date requise"),
  description:   z.string().trim().optional().or(z.literal("")),
  source:        z.enum(["MANUAL", "STRIPE", "BANK_IMPORT"]).default("MANUAL"),
  status:        z.enum(["PENDING", "PAID", "CANCELLED"]).default("PENDING"),
  reference:     z.string().trim().optional().or(z.literal("")),
})

export const incomeUpdateSchema = incomeSchema.partial()

export type IncomeInput       = z.infer<typeof incomeSchema>
export type IncomeUpdateInput = z.infer<typeof incomeUpdateSchema>

export const expenseSchema = z.object({
  amount:        z.number().positive("Montant doit être positif"),
  categoryId:    z.string().optional().or(z.literal("")),
  date:          z.string().min(1, "Date requise"),
  vendor:        z.string().trim().optional().or(z.literal("")),
  description:   z.string().trim().optional().or(z.literal("")),
  receiptUrl:    z.string().trim().optional().or(z.literal("")),
  internalNote:  z.string().trim().optional().or(z.literal("")),
  paymentMethod: z.string().optional().or(z.literal("")),
  status:        z.enum(["DRAFT", "VALIDATED", "CANCELLED"]).default("DRAFT"),
})

export const expenseUpdateSchema = expenseSchema.partial()

export type ExpenseInput       = z.infer<typeof expenseSchema>
export type ExpenseUpdateInput = z.infer<typeof expenseUpdateSchema>

export const bankTransactionUpdateSchema = z.object({
  status: z.enum(["UNMATCHED", "MATCHED", "PENDING", "IGNORED", "DUPLICATE"]),
})

export type BankTransactionUpdateInput = z.infer<typeof bankTransactionUpdateSchema>

export const importColumnMappingSchema = z.object({
  bankAccountId: z.string().min(1),
  dateColumn:    z.string().min(1),
  labelColumn:   z.string().min(1),
  valueMode:     z.enum(["single", "split"]),
  amountColumn:  z.string().optional(),
  debitColumn:   z.string().optional(),
  creditColumn:  z.string().optional(),
  balanceColumn: z.string().optional(),
})

export type ImportColumnMapping = z.infer<typeof importColumnMappingSchema>

export const importRowSchema = z.object({
  transactionDate: z.string(),
  label:           z.string(),
  amount:          z.number(),
  type:            z.enum(["CREDIT", "DEBIT"]),
  balanceAfter:    z.number().optional(),
  externalId:      z.string(),
})

export type ImportRow = z.infer<typeof importRowSchema>

// Same shape as a parsed statement row, minus externalId — the AI extracting rows from a
// PDF (src/app/api/finances/import/parse-pdf/route.ts) never produces that hash, it's
// computed client-side afterwards (import-wizard.tsx) exactly like the CSV path does.
// balanceAfter is widened to accept an explicit `null` (not just a missing key) and
// normalized to undefined — despite the prompt asking the model to omit it when unknown,
// JSON-mode completions frequently emit `null` anyway, and a strict `.optional()` alone
// would reject that value and silently drop an otherwise-valid transaction.
export const aiExtractedRowSchema = importRowSchema.omit({ externalId: true }).extend({
  balanceAfter: z.number().nullable().optional().transform(v => v ?? undefined),
})

export type AiExtractedRow = z.infer<typeof aiExtractedRowSchema>

export const reconcileActionSchema = z.object({
  bankTransactionId: z.string().min(1),
  action:            z.enum(["MATCH", "IGNORE", "DUPLICATE", "UNMATCH"]),
  incomeId:          z.string().optional(),
  expenseId:         z.string().optional(),
})

export type ReconcileActionInput = z.infer<typeof reconcileActionSchema>
