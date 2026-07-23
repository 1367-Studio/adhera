import { z } from "zod"

const phoneRegex = /^[+\d][\d\s.\-()]{5,19}$/

export const membreSchema = z.object({
  firstName: z.string().trim().min(1, "Prénom requis"),
  lastName:  z.string().trim().min(1, "Nom requis"),
  email:     z.string().trim().email("Email invalide").optional().or(z.literal("")),
  phone:     z.string().trim().optional().or(z.literal("")).refine(
    v => !v || phoneRegex.test(v),
    "Numéro de téléphone invalide",
  ),
  birthDate: z.string().optional().or(z.literal("")).refine(
    v => !v || new Date(v) < new Date(),
    "La date de naissance doit être dans le passé",
  ),
  address:   z.string().trim().optional().or(z.literal("")),
  civilite:      z.enum(["MME", "MLLE", "M"]).optional().or(z.literal("")),
  sexe:          z.enum(["HOMME", "FEMME"]).optional().or(z.literal("")),
  groupeSanguin: z.enum([
    "A_POSITIF", "A_NEGATIF",
    "B_POSITIF", "B_NEGATIF",
    "AB_POSITIF", "AB_NEGATIF",
    "O_POSITIF", "O_NEGATIF",
  ]).optional().or(z.literal("")),
  allergies:     z.string().trim().optional().or(z.literal("")),
  photoUrl:     z.string().trim().optional().or(z.literal("")),
  status:    z.enum(["PENDING", "ACTIF", "INACTIF", "SUSPENDU"]),
  typeId:    z.string().optional().or(z.literal("")),
})

export const membreCreateSchema = membreSchema.extend({
  email: z.string().trim().email("Email invalide").min(1, "Email requis"),
  role:  z.enum(["MEMBRE", "SECRETAIRE", "TRESORIER", "PRESIDENT", "ADMIN"]).optional(),
})

export const membreUpdateSchema = membreSchema.partial()

export type MembreInput       = z.infer<typeof membreSchema>
export type MembreCreateInput = z.infer<typeof membreCreateSchema>
export type MembreUpdateInput = z.infer<typeof membreUpdateSchema>
