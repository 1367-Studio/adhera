import { z } from "zod"

export const loginSchema = z.object({
  email:    z.string().min(1, "Email requis").email("Email invalide"),
  password: z.string().min(1, "Mot de passe requis"),
})

export type LoginInput = z.infer<typeof loginSchema>

export const registerSchema = z.object({
  associationName: z.string().min(2, "Nom requis (min. 2 caractères)"),
  city:            z.string().optional(),
  firstName:       z.string().min(1, "Prénom requis"),
  lastName:        z.string().min(1, "Nom requis"),
  email:           z.string().email("Email invalide"),
  password:        z.string().min(8, "Min. 8 caractères"),
  acceptedTerms:   z.literal(true, { message: "Vous devez accepter les CGS et la politique de confidentialité" }),
})

export type RegisterInput = z.infer<typeof registerSchema>

export const portalRegisterSchema = z.object({
  firstName:     z.string().min(1, "Prénom requis"),
  lastName:      z.string().min(1, "Nom requis"),
  email:         z.string().email("Email invalide"),
  typeId:        z.string().optional(),
  acceptedTerms: z.literal(true, { message: "Vous devez accepter la politique de confidentialité" }),
})

export type PortalRegisterInput = z.infer<typeof portalRegisterSchema>

export * from "./membre"
export * from "./evenement"
export * from "./cotisation"
export * from "./association"
export * from "./actualite"
export * from "./membre-type"
export * from "./finance"
