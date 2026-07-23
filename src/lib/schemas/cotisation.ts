import { z } from "zod"

const cotisationBase = z.object({
  membreId: z.string().min(1, "Membre requis"),
  year:     z.number().int().min(2000, "Année invalide").max(new Date().getFullYear() + 1, "Année invalide"),
  amount:   z.number().positive("Montant doit être positif"),
  status:   z.enum(["EN_ATTENTE", "PAYE", "EXONERE"]),
  paidAt:   z.string().optional().or(z.literal("")).refine(
    v => !v || new Date(v) <= new Date(),
    "La date de paiement ne peut pas être dans le futur",
  ),
  note:     z.string().trim().optional().or(z.literal("")),
})

export const cotisationSchema = cotisationBase.refine(
  (d) => d.status !== "PAYE" || (!!d.paidAt && d.paidAt !== ""),
  { message: "Date de paiement requise quand le statut est Payée", path: ["paidAt"] },
)

export const cotisationUpdateSchema = cotisationBase.omit({ membreId: true, year: true }).partial().refine(
  (d) => d.status !== "PAYE" || (!!d.paidAt && d.paidAt !== ""),
  { message: "Date de paiement requise quand le statut est Payée", path: ["paidAt"] },
)

export type CotisationInput       = z.infer<typeof cotisationSchema>
export type CotisationUpdateInput = z.infer<typeof cotisationUpdateSchema>
