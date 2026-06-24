import { z } from "zod"

export const tresorerieSchema = z.object({
  type:        z.enum(["ENTREE", "SORTIE"]),
  amount:      z.number().positive("Montant doit être positif"),
  description: z.string().trim().min(1, "Description requise"),
  date:        z.string().min(1, "Date requise"),
  category:    z.string().trim().optional().or(z.literal("")),
})

export const tresorerieUpdateSchema = tresorerieSchema.partial()

export type TresorerieInput       = z.infer<typeof tresorerieSchema>
export type TresorerieUpdateInput = z.infer<typeof tresorerieUpdateSchema>
