import { z } from "zod"
import { REFERENCE_ACCOUNTS, isValidAccountingCode } from "@/lib/finance/chart-of-accounts"

export const bankAccountSchema = z.object({
  bankName:       z.string().trim().min(1, "Nom de la banque requis"),
  accountName:    z.string().trim().min(1, "Nom du compte requis"),
  ibanLast4:      z.string().trim().max(4).optional().or(z.literal("")),
  currency:       z.string().default("EUR"),
  openingBalance: z.number().default(0),
  isActive:       z.boolean().default(true),
})

// Rebuilt as its own literal object instead of bankAccountSchema.partial() — Zod's
// .default() still fires on an omitted field even after .partial(), so a derived
// schema would silently inject "EUR"/0/true into every partial PATCH.
export const bankAccountUpdateSchema = z.object({
  bankName:       z.string().trim().min(1, "Nom de la banque requis").optional(),
  accountName:    z.string().trim().min(1, "Nom du compte requis").optional(),
  ibanLast4:      z.string().trim().max(4).optional().or(z.literal("")),
  currency:       z.string().optional(),
  openingBalance: z.number().optional(),
  isActive:       z.boolean().optional(),
})

export type BankAccountInput       = z.infer<typeof bankAccountSchema>
export type BankAccountUpdateInput = z.infer<typeof bankAccountUpdateSchema>

// accountingCode is required and restricted to the controlled reference list (chart-of-accounts.ts)
// — no more free text. The cross-field .refine below is what actually enforces "valid for this
// type": a code that's a real account but belongs to the other type (e.g. an EXPENSE code on an
// INCOME category) must still fail.
export const financeCategorySchema = z.object({
  name:          z.string().trim().min(1, "Nom requis"),
  type:          z.enum(["INCOME", "EXPENSE"]),
  accountingCode: z.string().trim().min(1, "Compte comptable requis"),
  section:       z.enum(["OPERATING", "FINANCIAL", "EXCEPTIONAL", "OTHER", "IN_KIND", "IMMOBILISATION"]).default("OPERATING"),
}).refine(data => isValidAccountingCode(data.accountingCode, data.type), {
  message: "Compte comptable invalide pour ce type",
  path:    ["accountingCode"],
})

// Rebuilt as its own literal object instead of financeCategorySchema.partial() — same
// .default() leak as bankAccountUpdateSchema/incomeUpdateSchema above: an omitted `section`
// must stay undefined so Prisma leaves the existing value untouched, not reset to "OPERATING".
// accountingCode can no longer be cleared to "" (see financeCategorySchema) — a PATCH that
// touches it must supply a real code from the controlled list. When `type` isn't part of the
// same PATCH, validate against the full reference list instead of one type's subset (the
// route can't know the category's persisted type at parse time); the UI form always submits
// both together, so this fallback only matters for a direct API caller.
export const financeCategoryUpdateSchema = z.object({
  name:          z.string().trim().min(1, "Nom requis").optional(),
  type:          z.enum(["INCOME", "EXPENSE"]).optional(),
  accountingCode: z.string().trim().min(1, "Compte comptable requis").optional(),
  section:       z.enum(["OPERATING", "FINANCIAL", "EXCEPTIONAL", "OTHER", "IN_KIND", "IMMOBILISATION"]).optional(),
}).refine(data => {
  if (!data.accountingCode) return true
  if (data.type) return isValidAccountingCode(data.accountingCode, data.type)
  return REFERENCE_ACCOUNTS.some(a => a.code === data.accountingCode)
}, {
  message: "Compte comptable invalide pour ce type",
  path:    ["accountingCode"],
})

export type FinanceCategoryInput       = z.infer<typeof financeCategorySchema>
export type FinanceCategoryUpdateInput = z.infer<typeof financeCategoryUpdateSchema>

export const incomeSchema = z.object({
  amount:        z.number().positive("Montant doit être positif"),
  categoryId:    z.string().optional().or(z.literal("")),
  projectId:     z.string().optional().or(z.literal("")),
  memberId:      z.string().optional().or(z.literal("")),
  paymentMethod: z.string().optional().or(z.literal("")),
  date:          z.string().min(1, "Date requise"),
  description:   z.string().trim().optional().or(z.literal("")),
  source:        z.enum(["MANUAL", "STRIPE", "BANK_IMPORT"]).default("MANUAL"),
  status:        z.enum(["PENDING", "PAID", "CANCELLED"]).default("PENDING"),
  reference:     z.string().trim().optional().or(z.literal("")),
})

// Rebuilt as its own literal object instead of incomeSchema.partial() — same .default()
// leak as bankAccountUpdateSchema. An omitted status/source must resolve to undefined
// so Prisma leaves the existing column untouched, not "PENDING"/"MANUAL".
export const incomeUpdateSchema = z.object({
  amount:        z.number().positive("Montant doit être positif").optional(),
  categoryId:    z.string().optional().or(z.literal("")),
  projectId:     z.string().optional().or(z.literal("")),
  memberId:      z.string().optional().or(z.literal("")),
  paymentMethod: z.string().optional().or(z.literal("")),
  date:          z.string().min(1, "Date requise").optional(),
  description:   z.string().trim().optional().or(z.literal("")),
  source:        z.enum(["MANUAL", "STRIPE", "BANK_IMPORT"]).optional(),
  status:        z.enum(["PENDING", "PAID", "CANCELLED"]).optional(),
  reference:     z.string().trim().optional().or(z.literal("")),
})

export type IncomeInput       = z.infer<typeof incomeSchema>
export type IncomeUpdateInput = z.infer<typeof incomeUpdateSchema>

export const expenseSchema = z.object({
  amount:        z.number().positive("Montant doit être positif"),
  categoryId:    z.string().optional().or(z.literal("")),
  projectId:     z.string().optional().or(z.literal("")),
  date:          z.string().min(1, "Date requise"),
  vendor:        z.string().trim().optional().or(z.literal("")),
  description:   z.string().trim().optional().or(z.literal("")),
  receiptUrl:    z.string().trim().optional().or(z.literal("")),
  internalNote:  z.string().trim().optional().or(z.literal("")),
  paymentMethod: z.string().optional().or(z.literal("")),
  status:        z.enum(["DRAFT", "VALIDATED", "CANCELLED"]).default("DRAFT"),
})

// Same fix as incomeUpdateSchema — status must stay undefined when omitted.
export const expenseUpdateSchema = z.object({
  amount:        z.number().positive("Montant doit être positif").optional(),
  categoryId:    z.string().optional().or(z.literal("")),
  projectId:     z.string().optional().or(z.literal("")),
  date:          z.string().min(1, "Date requise").optional(),
  vendor:        z.string().trim().optional().or(z.literal("")),
  description:   z.string().trim().optional().or(z.literal("")),
  receiptUrl:    z.string().trim().optional().or(z.literal("")),
  internalNote:  z.string().trim().optional().or(z.literal("")),
  paymentMethod: z.string().optional().or(z.literal("")),
  status:        z.enum(["DRAFT", "VALIDATED", "CANCELLED"]).optional(),
})

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
