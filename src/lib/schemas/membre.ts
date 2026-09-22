import { z } from "zod"
import { SPOKEN_LANGUAGE_CODES } from "@/lib/languages"
import { SUPPORTED_LOCALES } from "@/i18n/locales"
import { ADDRESS_MAX_LENGTHS } from "@/lib/address"

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
  // `address` reste le champ hérité en texte libre : un onglet resté ouvert sur l'ancien
  // formulaire continue de poster celui-là seul, et il doit rester accepté. Les cinq champs
  // ci-dessous sont ceux du formulaire actuel (voir AddressFields et src/lib/address.ts).
  address:   z.string().trim().max(300).optional().or(z.literal("")),
  addressStreet:     z.string().trim().max(ADDRESS_MAX_LENGTHS.street).optional().or(z.literal("")),
  addressComplement: z.string().trim().max(ADDRESS_MAX_LENGTHS.complement).optional().or(z.literal("")),
  postalCode:        z.string().trim().max(ADDRESS_MAX_LENGTHS.postalCode).optional().or(z.literal("")),
  city:              z.string().trim().max(ADDRESS_MAX_LENGTHS.city).optional().or(z.literal("")),
  country:           z.string().trim().max(ADDRESS_MAX_LENGTHS.country).optional().or(z.literal("")),
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
  preferredLocale: z.enum(SUPPORTED_LOCALES).optional().or(z.literal("")),
  spokenLanguage:  z.enum(SPOKEN_LANGUAGE_CODES).optional().or(z.literal("")),
  possedeTshirt: z.enum(["true", "false"]).optional().or(z.literal("")),
  tailleTshirt:  z.enum(["XS", "S", "M", "L", "XL", "XXL", "XXXL"]).optional().or(z.literal("")),
  status:    z.enum(["PENDING", "ACTIF", "INACTIF", "SUSPENDU"]),
  typeId:    z.string().optional().or(z.literal("")),
  responsableId: z.string().optional().or(z.literal("")),
  adherentOverride: z.enum(["true", "false"]).optional().or(z.literal("")),
})

export const membreCreateSchema = membreSchema.extend({
  email: z.string().trim().email("Email invalide").min(1, "Email requis"),
  role:  z.enum(["MEMBRE", "SECRETAIRE", "TRESORIER", "PRESIDENT", "ADMIN"]).optional(),
  // Tarif d'un formulaire d'adhésion publié — la cotisation créée reprend ce tarif (montant,
  // reçu fiscal, période) et le membre reçoit le lien de paiement public par email, comme
  // s'il s'était inscrit lui-même. Vide = comportement historique (montant par défaut).
  tierId: z.string().optional().or(z.literal("")),
  // Le gestionnaire atteste avoir recueilli l'accord de la personne sur les documents que
  // l'association impose d'accepter (papier, en personne…). Ce n'est pas l'accord de la
  // personne elle-même : c'est l'affirmation du gestionnaire, enregistrée à son nom.
  legalOfflineAttestation: z.boolean().optional(),
})

export const membreUpdateSchema = membreSchema.partial()

export type MembreInput       = z.infer<typeof membreSchema>
export type MembreCreateInput = z.infer<typeof membreCreateSchema>
export type MembreUpdateInput = z.infer<typeof membreUpdateSchema>
