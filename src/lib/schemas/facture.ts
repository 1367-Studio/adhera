import { z } from "zod"
import { devisItemSchema } from "@/lib/schemas/devis"

export const factureItemSchema = devisItemSchema

const factureObjectSchema = z.object({
  fournisseurId: z.string().optional().or(z.literal("")),
  devisId:       z.string().optional().or(z.literal("")),
  status:        z.enum(["BROUILLON", "EN_ATTENTE", "PARTIELLEMENT_PAYEE", "PAYEE", "EN_RETARD", "ANNULEE"]),
  issueDate:     z.string().min(1, "Date requise"),
  dueDate:       z.string().optional().or(z.literal("")),
  notes:         z.string().trim().optional().or(z.literal("")),
  paymentTerms:  z.string().trim().optional().or(z.literal("")),
  items:         z.array(factureItemSchema).min(1, "Au moins un article requis"),
})

// ISO "YYYY-MM-DD" strings compare correctly with plain `<`/`>=`, no Date parsing needed.
const dueDateNotBeforeIssueDate = (data: { issueDate: string; dueDate?: string }) =>
  !data.dueDate || data.dueDate >= data.issueDate

export const factureSchema = factureObjectSchema.refine(dueDateNotBeforeIssueDate, {
  message: "La date d'échéance ne peut pas précéder la date d'émission",
  path:    ["dueDate"],
})

export const factureCreateSchema = factureSchema
export const factureUpdateSchema = factureObjectSchema.partial().extend({
  items: z.array(factureItemSchema).min(1, "Au moins un article requis").optional(),
}).refine((data) => !data.issueDate || !data.dueDate || data.dueDate >= data.issueDate, {
  message: "La date d'échéance ne peut pas précéder la date d'émission",
  path:    ["dueDate"],
})

export const facturePaymentSchema = z.object({
  amount: z.number().positive("Montant invalide"),
  method: z.string().trim().min(1, "Méthode requise"),
  paidAt: z.string().optional().or(z.literal("")),
  note:   z.string().trim().optional().or(z.literal("")),
})

export type FactureInput        = z.infer<typeof factureSchema>
export type FactureCreateInput  = z.infer<typeof factureCreateSchema>
export type FactureUpdateInput  = z.infer<typeof factureUpdateSchema>
export type FacturePaymentInput = z.infer<typeof facturePaymentSchema>
