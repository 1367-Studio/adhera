import { z } from "zod"

// FORM-93 — header fields of a reimbursement request. requesterId is never part of this
// schema: every route resolves it from the session (ctx.userId), never trusts a client-
// supplied value — see POST /api/finances/reimbursements.
export const reimbursementRequestSchema = z.object({
  subject:   z.string().trim().min(1, "Objet requis"),
  comment:   z.string().trim().optional().or(z.literal("")),
  projectId: z.string().optional().or(z.literal("")),
  eventId:   z.string().optional().or(z.literal("")),
})

export const reimbursementRequestUpdateSchema = z.object({
  subject:   z.string().trim().min(1, "Objet requis").optional(),
  comment:   z.string().trim().optional().or(z.literal("")),
  projectId: z.string().optional().or(z.literal("")),
  eventId:   z.string().optional().or(z.literal("")),
})

export type ReimbursementRequestInput       = z.infer<typeof reimbursementRequestSchema>
export type ReimbursementRequestUpdateInput = z.infer<typeof reimbursementRequestUpdateSchema>

// One expense line — categoryId/receiptUrl are mandatory here (unlike the plain Expense form),
// per the ticket's "no submission without a category and a receipt on every item" rule.
export const reimbursementItemSchema = z.object({
  date:        z.string().min(1, "Date requise"),
  description: z.string().trim().min(1, "Description requise"),
  amount:      z.number().positive("Montant doit être positif"),
  categoryId:  z.string().min(1, "Catégorie requise"),
  receiptUrl:  z.string().trim().min(1, "Justificatif requis"),
  receiptFileName: z.string().trim().optional().or(z.literal("")),
  // Same flag and meaning as Expense.isImmobilisation (FORM-107) — see ReimbursementItem's
  // own doc comment in schema.prisma for why it has to live here, not only on the Expense.
  isImmobilisation: z.boolean().default(false),
})

export const reimbursementItemUpdateSchema = z.object({
  date:        z.string().min(1, "Date requise").optional(),
  description: z.string().trim().min(1, "Description requise").optional(),
  amount:      z.number().positive("Montant doit être positif").optional(),
  categoryId:  z.string().min(1, "Catégorie requise").optional(),
  receiptUrl:  z.string().trim().min(1, "Justificatif requis").optional(),
  receiptFileName: z.string().trim().optional().or(z.literal("")),
  isImmobilisation: z.boolean().optional(),
})

export type ReimbursementItemInput       = z.infer<typeof reimbursementItemSchema>
export type ReimbursementItemUpdateInput = z.infer<typeof reimbursementItemUpdateSchema>

// Optional per-item category corrections an approver can make while approving — logged, never
// silent (see POST /[id]/approve).
export const reimbursementApproveSchema = z.object({
  categoryCorrections: z.array(z.object({
    itemId:     z.string().min(1),
    categoryId: z.string().min(1),
  })).optional(),
})

export const reimbursementDecisionNoteSchema = z.object({
  note: z.string().trim().min(1, "Un commentaire est requis"),
})

export const reimbursementCancelSchema = z.object({
  reason: z.string().trim().optional().or(z.literal("")),
})

export const reimbursementRegisterSchema = z.object({
  date:          z.string().min(1, "Date requise"),
  paymentMethod: z.enum(["VIREMENT", "CHEQUE", "ESPECES"]),
  bankAccountId: z.string().optional().or(z.literal("")),
  reference:     z.string().trim().optional().or(z.literal("")),
  bankTransactionId: z.string().optional().or(z.literal("")),
}).refine(data => data.paymentMethod === "ESPECES" || !!data.bankAccountId, {
  message: "Compte bancaire requis pour ce mode de paiement",
  path:    ["bankAccountId"],
})

export type ReimbursementApproveInput  = z.infer<typeof reimbursementApproveSchema>
export type ReimbursementCancelInput   = z.infer<typeof reimbursementCancelSchema>
export type ReimbursementRegisterInput = z.infer<typeof reimbursementRegisterSchema>
