import { z } from "zod"
import { ADDRESS_MAX_LENGTHS } from "@/lib/address"

// One row = one AssoConnect "adhésion" transaction, already normalized client-side (dates,
// address concatenation, sexe/civilité mapping — see membre-import-wizard.tsx's parseRows).
// The server only re-validates shape/presence, mirroring the light-touch approach of
// importRowSchema (src/lib/schemas/finance.ts) — real business rules (amount>0, dedup) stay
// in the route, same split as the bank-statement import.
export const importMembreRowSchema = z.object({
  firstName:  z.string().trim().min(1),
  lastName:   z.string().trim().min(1),
  externalId: z.string().trim().optional(), // AssoConnect "ID contact" — see Membre.externalId
  email:      z.string().trim().optional(),
  phone:      z.string().trim().optional(),
  // Le fichier source fournit déjà voie / complément / code postal / ville / pays en
  // colonnes séparées : elles sont désormais transmises telles quelles au lieu d'être
  // concaténées côté client. `address` reste accepté pour les lignes qui n'ont qu'un texte
  // libre (et pour un onglet resté ouvert sur l'ancienne version).
  address:    z.string().trim().max(300).optional(),
  addressStreet:     z.string().trim().max(ADDRESS_MAX_LENGTHS.street).optional(),
  addressComplement: z.string().trim().max(ADDRESS_MAX_LENGTHS.complement).optional(),
  postalCode:        z.string().trim().max(ADDRESS_MAX_LENGTHS.postalCode).optional(),
  city:              z.string().trim().max(ADDRESS_MAX_LENGTHS.city).optional(),
  country:           z.string().trim().max(ADDRESS_MAX_LENGTHS.country).optional(),
  sexe:       z.enum(["HOMME", "FEMME"]).optional(),
  civilite:   z.enum(["MME", "MLLE", "M"]).optional(),
  birthDate:  z.string().optional(), // ISO yyyy-mm-dd
  // Cotisation fields — absent/amount<=0 means "contact only, no cotisation this row".
  year:         z.number().int().optional(),
  amount:       z.number().optional(),
  periodStart:  z.string().optional(),
  periodEnd:    z.string().optional(),
  paymentReceived: z.boolean().optional(),
  paidAt:       z.string().optional(),
  method:       z.enum(["CB", "CHQ", "ESP", "En ligne", "Autre"]).optional(),
  note:         z.string().trim().optional(),
})

export type ImportMembreRow = z.infer<typeof importMembreRowSchema>
