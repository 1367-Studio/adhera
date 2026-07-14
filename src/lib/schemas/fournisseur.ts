import { z } from "zod"

// French business identifiers — validated only when present, since a fournisseur based
// outside France (see `country`) legitimately has none of these.
const siretField = z.string().trim().optional().or(z.literal(""))
  .refine((v) => !v || /^\d{14}$/.test(v), { message: "Le SIRET doit comporter 14 chiffres" })
const sirenField = z.string().trim().optional().or(z.literal(""))
  .refine((v) => !v || /^\d{9}$/.test(v), { message: "Le SIREN doit comporter 9 chiffres" })
const vatNumberField = z.string().trim().optional().or(z.literal(""))
  .refine((v) => !v || /^[A-Za-z]{2}[A-Za-z0-9]{2,13}$/.test(v), { message: "Numéro de TVA invalide (ex: FR32123456789)" })

export const fournisseurSchema = z.object({
  companyName:  z.string().trim().min(1, "Raison sociale requise"),
  tradeName:    z.string().trim().optional().or(z.literal("")),
  contactName:  z.string().trim().optional().or(z.literal("")),
  contactRole:  z.string().trim().optional().or(z.literal("")),
  siret:        siretField,
  siren:        sirenField,
  vatNumber:    vatNumberField,
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
