import { z } from "zod"

const evenementFieldRequirement = z.enum(["HIDDEN", "OPTIONAL", "REQUIRED"])

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
  // Opt-in — voir le commentaire du champ dans schema.prisma.
  waitlistEnabled: z.boolean().optional(),
  // Opt-in : renseigné, cette adresse reçoit un email à chaque inscription. Les
  // gestionnaires reçoivent de toute façon une notification in-app — voir
  // notifyEventRegistration.
  adminNotificationEmail: z.string().trim().email("Adresse email invalide").max(200).optional().or(z.literal("")),
  // Contact affiché aux visiteurs sur la page publique — voir le commentaire du champ dans
  // schema.prisma. Distinct de adminNotificationEmail ci-dessus (interne, jamais montré).
  contactEmail: z.string().trim().email("Adresse email invalide").max(200).optional().or(z.literal("")),
  contactPhone: z.string().trim().max(30).optional().or(z.literal("")),

  // Étape "Formulaire" — miroir de MembershipForm.fieldPhone/fieldAddress/fieldBirthDate/
  // fieldGender/fieldMobile.
  fieldPhone:     evenementFieldRequirement.optional(),
  fieldAddress:   evenementFieldRequirement.optional(),
  fieldBirthDate: evenementFieldRequirement.optional(),
  fieldGender:    evenementFieldRequirement.optional(),
  fieldMobile:    evenementFieldRequirement.optional(),

  // Étape "Paiement" — miroir de MembershipForm.allowCash/allowCheque/allowTransfer.
  allowCash:           z.boolean().optional(),
  allowCheque:         z.boolean().optional(),
  allowTransfer:       z.boolean().optional(),
  offlineInstructions: z.string().trim().optional().or(z.literal("")),
  confirmationMessage: z.string().trim().optional().or(z.literal("")),

  // Étape "Publication" — miroir de MembershipForm.visibility/opensAt/closesAt (sans SITE, voir
  // schema.prisma).
  visibility: z.enum(["LINK", "PRIVATE"]).optional(),
  opensAt:    z.string().optional().or(z.literal("")),
  closesAt:   z.string().optional().or(z.literal("")),

  // CGU, anexos administrativos e assinatura — miroir de MembershipForm.conditions/
  // attachments/requireCguvSignature.
  conditions:           z.string().max(20000).optional().or(z.literal("")),
  attachments:          z.array(z.object({ url: z.string(), filename: z.string(), size: z.number() })).max(1).optional().nullable(),
  requireCguvSignature: z.boolean().optional(),
})

export const evenementSchema = evenementBase.refine(
  (d) => !d.endDate || d.endDate === "" || d.endDate > d.date,
  { message: "La date de fin doit être après la date de début", path: ["endDate"] },
).refine(
  (d) => !d.opensAt || !d.closesAt || d.opensAt === "" || d.closesAt === "" || d.closesAt > d.opensAt,
  { message: "La date de fermeture doit être après la date d'ouverture", path: ["closesAt"] },
)

export const evenementUpdateSchema = evenementBase.partial()

export type EvenementInput       = z.infer<typeof evenementSchema>
export type EvenementUpdateInput = z.infer<typeof evenementUpdateSchema>

const CHOICE_FIELD_TYPES = ["SELECT", "RADIO", "CHECKBOX_MULTI"]

const evenementCustomFieldSchema = z.object({
  id:       z.string().optional(), // absent = nouveau champ
  type:     z.enum(["TEXT", "NUMBER", "FILE", "LONG_TEXT", "DATE", "SELECT", "RADIO", "CHECKBOX_MULTI", "BOOLEAN"]),
  label:    z.string().trim().min(1).max(100),
  required: z.boolean().optional().default(false),
  // Liste de choix — uniquement pour SELECT/RADIO/CHECKBOX_MULTI, ignoré sinon.
  options:  z.array(z.string().trim().min(1).max(200)).max(50).optional().nullable(),
}).refine(
  // Revalidé ici, pas seulement côté client (evenement-custom-fields-editor.tsx) — sinon un
  // champ à choix sans au moins 2 options atteint la DB et devient une question à laquelle le
  // formulaire public ne peut plus jamais répondre (rien à afficher/cocher).
  (d) => !CHOICE_FIELD_TYPES.includes(d.type) || (d.options?.length ?? 0) >= 2,
  { message: "Un champ à choix doit avoir au moins 2 options", path: ["options"] },
)

// PUT remplace toujours la liste entière — plus simple qu'un diff add/remove/reorder,
// et ce n'est éditable que par un admin sur un formulaire de quelques champs.
export const evenementCustomFieldsSchema = z.array(evenementCustomFieldSchema).max(20)

export type EvenementCustomFieldInput = z.infer<typeof evenementCustomFieldSchema>

const evenementTicketTypeSchema = z.object({
  id:                  z.string().optional(), // absent = nouveau tarif
  // TICKET = tarif normale ; DONATION = extra optionnel, `price` devient un montant minimum
  // — voir le commentaire du champ dans schema.prisma.
  itemType:            z.enum(["TICKET", "DONATION"]).optional().default("TICKET"),
  label:               z.string().trim().min(1).max(100),
  price:               z.number().nonnegative(),
  // Prix barré purement cosmétique — voir le commentaire du champ dans schema.prisma.
  priceBeforeDiscount: z.number().positive().nullish(),
  capacity:            z.number().int().positive().nullish(), // absent/null = illimité
  // Reçu fiscal — miroir de MembershipTier/DonationTier.receiptMode/ineligibleAmount.
  receiptMode:         z.enum(["NONE", "FULL", "PARTIAL"]).optional().default("NONE"),
  ineligibleAmount:    z.number().nonnegative().nullish(),
  // Cache la tarif du formulaire public sans la supprimer — voir le commentaire du champ
  // dans schema.prisma.
  active:              z.boolean().optional().default(true),
  // Fenêtre de vente propre à cette tarif — voir le commentaire du champ dans schema.prisma.
  opensAt:             z.string().optional().or(z.literal("")),
  closesAt:            z.string().optional().or(z.literal("")),
}).refine(
  (d) => d.itemType !== "DONATION" || d.receiptMode !== "PARTIAL",
  { message: "Une tarif de type don ne peut pas avoir un reçu partiel", path: ["receiptMode"] },
).refine(
  (d) => d.itemType !== "DONATION" || d.capacity == null,
  { message: "Une tarif de type don ne peut pas avoir de capacité", path: ["capacity"] },
).refine(
  (d) => !d.opensAt || !d.closesAt || d.opensAt === "" || d.closesAt === "" || d.closesAt > d.opensAt,
  { message: "La date de fermeture doit être après la date d'ouverture", path: ["closesAt"] },
)

export const evenementTicketTypesSchema = z.array(evenementTicketTypeSchema).max(20)

export type EvenementTicketTypeInput = z.infer<typeof evenementTicketTypeSchema>

const evenementDiscountCodeSchema = z.object({
  id:            z.string().optional(), // absent = nouveau code
  code:          z.string().trim().min(1).max(30),
  kind:          z.enum(["FIXED", "PERCENT"]),
  value:         z.number().positive(),
  startsAt:      z.string().optional().or(z.literal("")),
  endsAt:        z.string().optional().or(z.literal("")),
  maxUses:       z.number().int().positive().nullish(),
  active:        z.boolean().optional().default(true),
  // Vide = s'applique à toutes les tarifs TICKET de l'événement — voir le commentaire du
  // champ dans schema.prisma.
  ticketTypeIds: z.array(z.string()).optional().default([]),
}).refine(
  (d) => d.kind !== "PERCENT" || d.value <= 100,
  { message: "Un pourcentage ne peut pas dépasser 100", path: ["value"] },
).refine(
  (d) => !d.startsAt || !d.endsAt || d.startsAt === "" || d.endsAt === "" || d.endsAt > d.startsAt,
  { message: "La date de fin doit être après la date de début", path: ["endsAt"] },
)

export const evenementDiscountCodesSchema = z.array(evenementDiscountCodeSchema).max(50)

export type EvenementDiscountCodeInput = z.infer<typeof evenementDiscountCodeSchema>
