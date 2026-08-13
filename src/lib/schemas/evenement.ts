import { z } from "zod"

const evenementBase = z.object({
  title:       z.string().trim().min(1, "Titre requis"),
  description: z.string().trim().optional().or(z.literal("")),
  imageUrl:    z.string().trim().optional().or(z.literal("")),
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

const evenementCustomFieldSchema = z.object({
  id:       z.string().optional(), // absent = nouveau champ
  type:     z.enum(["TEXT", "NUMBER"]),
  label:    z.string().trim().min(1).max(100),
  required: z.boolean().optional().default(false),
})

// PUT remplace toujours la liste entière — plus simple qu'un diff add/remove/reorder,
// et ce n'est éditable que par un admin sur un formulaire de quelques champs.
export const evenementCustomFieldsSchema = z.array(evenementCustomFieldSchema).max(20)

export type EvenementCustomFieldInput = z.infer<typeof evenementCustomFieldSchema>

const evenementTicketTypeSchema = z.object({
  id:       z.string().optional(), // absent = nouveau tarif
  label:    z.string().trim().min(1).max(100),
  price:    z.number().nonnegative(),
  capacity: z.number().int().positive().nullish(), // absent/null = illimité
})

export const evenementTicketTypesSchema = z.array(evenementTicketTypeSchema).max(20)

export type EvenementTicketTypeInput = z.infer<typeof evenementTicketTypeSchema>
