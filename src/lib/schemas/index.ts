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
  acceptedTerms:   z.literal(true, { message: "Vous devez accepter les CGV et la politique de confidentialité" }),
})

export type RegisterInput = z.infer<typeof registerSchema>

export const portalRegisterSchema = z.object({
  firstName:     z.string().min(1, "Prénom requis"),
  lastName:      z.string().min(1, "Nom requis"),
  email:         z.string().email("Email invalide"),
  typeId:        z.string().optional(),
  acceptedTerms: z.literal(true, { message: "Vous devez accepter la politique de confidentialité" }),
  locale:        z.enum(["fr", "en", "pt", "pt-PT", "es"]).optional(),
})

export type PortalRegisterInput = z.infer<typeof portalRegisterSchema>

export * from "./actualite"
export * from "./association"
export * from "./billing"
export * from "./cotisation"
export * from "./devis"
export * from "./evenement"
export * from "./exercice"
export * from "./facture"
export * from "./facture-recue"
export * from "./finance"
export * from "./fournisseur"
export * from "./meeting"
export * from "./membre"
export * from "./membre-import"
export * from "./membre-type"

