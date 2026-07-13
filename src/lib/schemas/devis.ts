import { z } from "zod"

export const devisItemSchema = z.object({
  id:          z.string().optional(),
  description: z.string().trim().min(1, "Description requise"),
  quantity:    z.number().positive("Quantité invalide"),
  unitPrice:   z.number().min(0, "Prix invalide"),
  vatRate:     z.number().min(0).max(100),
  discount:    z.number().min(0),
}).superRefine((item, ctx) => {
  // Without this, a discount bigger than the line's own value (quantity × unitPrice)
  // drives that line — and potentially the whole document's total — negative. Nothing
  // downstream (Decimal columns, the payment overpayment check) expects a negative total.
  if (item.discount > item.quantity * item.unitPrice) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["discount"], message: "La remise ne peut pas dépasser le montant de la ligne" })
  }
})

const devisObjectSchema = z.object({
  fournisseurId: z.string().optional().or(z.literal("")),
  status:        z.enum(["BROUILLON", "ENVOYE", "ACCEPTE", "REFUSE", "EXPIRE"]),
  issueDate:     z.string().min(1, "Date requise"),
  validUntil:    z.string().optional().or(z.literal("")),
  notes:         z.string().trim().optional().or(z.literal("")),
  paymentTerms:  z.string().trim().optional().or(z.literal("")),
  items:         z.array(devisItemSchema).min(1, "Au moins un article requis"),
})

// ISO "YYYY-MM-DD" strings compare correctly with plain `<`/`>=`, no Date parsing needed.
const validUntilNotBeforeIssueDate = (data: { issueDate: string; validUntil?: string }) =>
  !data.validUntil || data.validUntil >= data.issueDate

export const devisSchema = devisObjectSchema.refine(validUntilNotBeforeIssueDate, {
  message: "La date de validité ne peut pas précéder la date d'émission",
  path:    ["validUntil"],
})

export const devisCreateSchema = devisSchema
export const devisUpdateSchema = devisObjectSchema.partial().extend({
  items: z.array(devisItemSchema).min(1, "Au moins un article requis").optional(),
}).refine((data) => !data.issueDate || !data.validUntil || data.validUntil >= data.issueDate, {
  message: "La date de validité ne peut pas précéder la date d'émission",
  path:    ["validUntil"],
})

export type DevisItemInput   = z.infer<typeof devisItemSchema>
export type DevisInput       = z.infer<typeof devisSchema>
export type DevisCreateInput = z.infer<typeof devisCreateSchema>
export type DevisUpdateInput = z.infer<typeof devisUpdateSchema>
