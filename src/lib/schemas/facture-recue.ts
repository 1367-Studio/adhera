import { z } from "zod"

export const factureRecueSchema = z.object({
  fournisseurId: z.string().optional().or(z.literal("")),
  number:        z.string().trim().optional().or(z.literal("")),
  type:          z.enum(["facture", "devis_recu", "comprovante", "contrat", "autre"]),
  issueDate:     z.string().min(1, "Date requise"),
  amount:        z.number().positive("Montant invalide"),
  status:        z.enum(["A_PAYER", "PAYEE", "EN_LITIGE", "ANNULEE"]),
  fileUrl:       z.string().trim().min(1, "Document requis"),
  notes:         z.string().trim().optional().or(z.literal("")),
})

export const factureRecueCreateSchema = factureRecueSchema
export const factureRecueUpdateSchema = factureRecueSchema.partial()

export type FactureRecueInput       = z.infer<typeof factureRecueSchema>
export type FactureRecueCreateInput = z.infer<typeof factureRecueCreateSchema>
export type FactureRecueUpdateInput = z.infer<typeof factureRecueUpdateSchema>
