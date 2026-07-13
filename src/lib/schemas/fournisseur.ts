import { z } from "zod"

export const fournisseurSchema = z.object({
  companyName:  z.string().trim().min(1, "Raison sociale requise"),
  tradeName:    z.string().trim().optional().or(z.literal("")),
  contactName:  z.string().trim().optional().or(z.literal("")),
  contactRole:  z.string().trim().optional().or(z.literal("")),
  siret:        z.string().trim().optional().or(z.literal("")),
  siren:        z.string().trim().optional().or(z.literal("")),
  vatNumber:    z.string().trim().optional().or(z.literal("")),
  address:      z.string().trim().optional().or(z.literal("")),
  city:         z.string().trim().optional().or(z.literal("")),
  postalCode:   z.string().trim().optional().or(z.literal("")),
  country:      z.string().trim().optional().or(z.literal("")),
  email:        z.string().trim().email("Email invalide").optional().or(z.literal("")),
  billingEmail: z.string().trim().email("Email invalide").optional().or(z.literal("")),
  phone:        z.string().trim().optional().or(z.literal("")),
  website:      z.string().trim().optional().or(z.literal("")),
  category:     z.string().trim().optional().or(z.literal("")),
  status:       z.enum(["ACTIF", "INACTIF", "ARCHIVE"]),
  notes:        z.string().trim().optional().or(z.literal("")),
})

export const fournisseurCreateSchema = fournisseurSchema
export const fournisseurUpdateSchema = fournisseurSchema.partial()

export type FournisseurInput       = z.infer<typeof fournisseurSchema>
export type FournisseurCreateInput = z.infer<typeof fournisseurCreateSchema>
export type FournisseurUpdateInput = z.infer<typeof fournisseurUpdateSchema>
