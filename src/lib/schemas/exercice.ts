// src/lib/schemas/exercice.ts
import { z } from "zod"

export const exerciceComptableSchema = z.object({
  label:      z.string().trim().min(1, "Libellé requis"),
  startDate:  z.string().min(1, "Date de début requise"),
  endDate:    z.string().min(1, "Date de fin requise"),
  // Returned by the client after confirmation of a GAP_WARNING — see POST /finances/exercices.
  confirmGap: z.boolean().optional(),
}).refine((data) => data.endDate >= data.startDate, {
  message: "La date de fin ne peut pas précéder la date de début",
  path:    ["endDate"],
})

export type ExerciceComptableInput = z.infer<typeof exerciceComptableSchema>

export const exerciceComptableUpdateSchema = z.object({
  label:  z.string().trim().min(1, "Libellé requis").optional(),
  status: z.enum(["OUVERT", "CLOTURE"]).optional(),
})

export type ExerciceComptableUpdateInput = z.infer<typeof exerciceComptableUpdateSchema>
