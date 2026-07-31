import { z } from "zod"

const cotisationBase = z.object({
  membreId:      z.string().min(1, "Membre requis"),
  year:          z.number().int().min(2000, "Année invalide").max(new Date().getFullYear() + 1, "Année invalide"),
  amount:        z.number().positive("Montant doit être positif"),
  status:        z.enum(["EN_ATTENTE", "PARTIELLEMENT_PAYEE", "PAYE", "EXONERE"]),
  paidAt:        z.string().optional().or(z.literal("")).refine(
    v => !v || new Date(v) <= new Date(),
    "La date de paiement ne peut pas être dans le futur",
  ),
  dueDate:       z.string().optional().or(z.literal("")),
  paymentMethod: z.enum(["CB", "CHQ", "ESP", "En ligne"]).optional().or(z.literal("")),
  note:          z.string().trim().optional().or(z.literal("")),
})

export const cotisationSchema = cotisationBase.refine(
  (d) => d.status !== "PAYE" || (!!d.paidAt && d.paidAt !== ""),
  { message: "Date de paiement requise quand le statut est Payée", path: ["paidAt"] },
).refine(
  (d) => d.status !== "PAYE" || !!d.paymentMethod,
  { message: "Moyen de paiement requis quand le statut est Payée", path: ["paymentMethod"] },
)

// No "paidAt/paymentMethod required when status is PAYE" refine here unlike cotisationSchema
// above — on an update, PAYE might just mean "still PAYE" while editing an unrelated field
// (e.g. the note) on an already-settled cotisation, where re-picking a payment method makes
// no sense. That requirement only applies to a genuine EN_ATTENTE/PARTIELLEMENT_PAYEE → PAYE
// transition, which the route validates against the record's actual prior status instead
// (see the `becomingPaid` check in src/app/api/cotisations/[id]/route.ts).
export const cotisationUpdateSchema = cotisationBase.omit({ membreId: true, year: true }).partial()

export const cotisationPaymentSchema = z.object({
  amount: z.number().positive("Montant invalide"),
  method: z.enum(["CB", "CHQ", "ESP", "En ligne"]),
  paidAt: z.string().optional().or(z.literal("")),
  note:   z.string().trim().optional().or(z.literal("")),
})

export type CotisationInput        = z.infer<typeof cotisationSchema>
export type CotisationUpdateInput  = z.infer<typeof cotisationUpdateSchema>
export type CotisationPaymentInput = z.infer<typeof cotisationPaymentSchema>
