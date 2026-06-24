import { z } from "zod"

export const associationSchema = z.object({
  name:    z.string().trim().min(1, "Nom requis"),
  city:    z.string().trim().optional().or(z.literal("")),
  country: z.string().trim().min(1, "Pays requis"),
})

export type AssociationInput = z.infer<typeof associationSchema>
