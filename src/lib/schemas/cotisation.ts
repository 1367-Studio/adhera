import { z } from "zod"

const EPSILON = 0.01

// Installments are optional — most cotisations still use the single `dueDate` field below.
// When present, they replace dueDate as the source of "is this late" (see
// src/lib/cotisation-status.ts's isLate) and their amounts must sum to the cotisation's own
// `amount`, enforced by the cross-field refine on cotisationSchema/cotisationUpdateSchema.
const cotisationInstallmentSchema = z.object({
  amount:  z.number().positive("Montant invalide"),
  dueDate: z.string().min(1, "Date d'échéance requise"),
})

const cotisationBase = z.object({
  membreId:      z.string().min(1, "Membre requis"),
  year:          z.number().int().min(2000, "Année invalide").max(new Date().getFullYear() + 1, "Année invalide"),
  amount:        z.number().positive("Montant doit être positif"),
  // EN_ATTENTE/PARTIELLEMENT_PAYEE/PAYE/EN_RETARD are never client-settable — they're
  // derived automatically from payments/dueDate/installments (see deriveCotisationStatus).
  // Only EXONERE and ANNULEE can be asserted by an admin. `null` means "clear any manual
  // override and go back to automatic" (the form's "Automatique" option) — distinct from
  // `undefined`/omitted, which leaves an existing manual override untouched (a plain note
  // edit shouldn't silently un-cancel a cancelled cotisation).
  status:        z.enum(["EXONERE", "ANNULEE"]).nullable().optional(),
  dueDate:       z.string().optional().or(z.literal("")),
  installments:  z.array(cotisationInstallmentSchema).max(60).optional(),
  note:          z.string().trim().optional().or(z.literal("")),
})

export function installmentsSumMismatch(d: { amount: number; installments?: { amount: number }[] }) {
  if (!d.installments || d.installments.length === 0) return false
  const total = d.installments.reduce((sum, i) => sum + i.amount, 0)
  return Math.abs(total - d.amount) > EPSILON
}

export const cotisationSchema = cotisationBase.refine(
  (d) => !installmentsSumMismatch(d),
  { message: "Le total des échéances ne correspond pas au montant de la cotisation.", path: ["installments"] },
)

// No cross-field refine here (unlike cotisationSchema above): on an update, `installments`
// can be present without `amount` in the same payload (only the schedule changed, not the
// price), and the schema has no way to know the cotisation's *existing* amount to validate
// against. That check happens in the PATCH route instead, against `resolvedAmount` — see
// src/app/api/cotisations/[id]/route.ts. Validating here with a 0 fallback would either wrongly
// reject a valid installments-only edit or (the previous bug) silently skip validation whenever
// amount was omitted.
export const cotisationUpdateSchema = cotisationBase.omit({ membreId: true, year: true }).partial()

export const cotisationPaymentSchema = z.object({
  amount: z.number().positive("Montant invalide"),
  method: z.enum(["CB", "CHQ", "ESP", "En ligne", "Autre"]),
  paidAt: z.string().optional().or(z.literal("")),
  note:   z.string().trim().optional().or(z.literal("")),
})

export type CotisationInput           = z.infer<typeof cotisationSchema>
export type CotisationUpdateInput     = z.infer<typeof cotisationUpdateSchema>
export type CotisationPaymentInput    = z.infer<typeof cotisationPaymentSchema>
export type CotisationInstallmentInput = z.infer<typeof cotisationInstallmentSchema>
