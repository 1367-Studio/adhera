import { z } from "zod"

export const MEMBRE_TYPE_COLORS = [
  "gray", "blue", "green", "yellow", "orange", "red", "purple", "pink", "indigo",
] as const

export type MembreTypeColor = typeof MEMBRE_TYPE_COLORS[number]

export const NAME_MAX        = 30
export const DESCRIPTION_MAX = 120

export const membreTypeSchema = z.object({
  name:        z.string().trim().min(1, "Nom requis").max(NAME_MAX, `Maximum ${NAME_MAX} caractères`),
  description: z.string().trim().max(DESCRIPTION_MAX, `Maximum ${DESCRIPTION_MAX} caractères`).optional().or(z.literal("")),
  color:       z.enum(MEMBRE_TYPE_COLORS),
})

export const membreTypeUpdateSchema = membreTypeSchema.partial()

export type MembreTypeInput       = z.infer<typeof membreTypeSchema>
export type MembreTypeUpdateInput = z.infer<typeof membreTypeUpdateSchema>
