import { z } from "zod"

export const factureRecueSchema = z.object({
  fournisseurId: z.string().optional().or(z.literal("")),
  number:        z.string().trim().optional().or(z.literal("")),
  type:          z.enum(["facture", "devis_recu", "comprovante", "contrat", "autre"]),
  issueDate:     z.string().min(1, "Date requise"),
  amount:        z.number().positive("Montant invalide"),
  // PAYEE/PARTIELLEMENT_PAYEE aren't manual choices (FORM-107 Fase 3) — same posture as
  // Facture's own status, see resolveManualFactureRecueStatus. A client-sent value of either
  // is reconciled against amountPaid/amount by the route, never trusted as-is.
  status:        z.enum(["A_PAYER", "PARTIELLEMENT_PAYEE", "PAYEE", "EN_LITIGE", "ANNULEE"]),
  fileUrl:       z.string().trim().min(1, "Document requis"),
  notes:         z.string().trim().optional().or(z.literal("")),
})

export const factureRecueCreateSchema = factureRecueSchema
export const factureRecueUpdateSchema = factureRecueSchema.partial()

export type FactureRecueInput       = z.infer<typeof factureRecueSchema>
export type FactureRecueCreateInput = z.infer<typeof factureRecueCreateSchema>
export type FactureRecueUpdateInput = z.infer<typeof factureRecueUpdateSchema>

// Mirrors facturePaymentSchema (Facture/emitted side) exactly — see FactureRecuePayment.
export const factureRecuePaymentSchema = z.object({
  amount: z.number().positive("Montant invalide"),
  method: z.string().trim().min(1, "Méthode requise"),
  paidAt: z.string().optional().or(z.literal("")),
  note:   z.string().trim().optional().or(z.literal("")),
})

export type FactureRecuePaymentInput = z.infer<typeof factureRecuePaymentSchema>
