import { z } from "zod"

const evenementBase = z.object({
  title:       z.string().trim().min(1, "Titre requis"),
  description: z.string().trim().optional().or(z.literal("")),
  date:        z.string().min(1, "Date requise"),
  endDate:     z.string().optional().or(z.literal("")),
  location:    z.string().trim().optional().or(z.literal("")),
  lat:         z.number().optional(),
  lng:         z.number().optional(),
  price:       z.number().nonnegative().optional(),
  capacity:    z.number().int().positive().optional(),
})

export const evenementSchema = evenementBase.refine(
  (d) => !d.endDate || d.endDate === "" || d.endDate > d.date,
  { message: "La date de fin doit être après la date de début", path: ["endDate"] },
)

export const evenementUpdateSchema = evenementBase.partial()

export type EvenementInput       = z.infer<typeof evenementSchema>
export type EvenementUpdateInput = z.infer<typeof evenementUpdateSchema>
