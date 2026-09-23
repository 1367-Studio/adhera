import type { EvenementPaymentMethod, Participation, Prisma } from "@prisma/client"
import { z } from "zod"
import { eligibleReceiptAmount } from "@/lib/receipt-eligibility"
import { ON_SITE_PAYMENT_METHODS, managerOnSitePaymentMethods, type OnSitePaymentMethod } from "@/lib/evenement-payment-methods"

type TxClient = Prisma.TransactionClient

// Single place that records a ticket as paid by a manager ("Marquer payé" on the presences
// page, and "Ajouter + payé maintenant" when adding someone at the door) — tier resolution,
// amount, receipt snapshot and the matching Income row. Callers own auth, the closed-exercice
// guard and the activity log.

export class TicketPaymentError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export const evenementTicketPaymentSelect = {
  title:        true,
  price:        true,
  allowCash:    true,
  allowCheque:  true,
  allowTransfer: true,
  ticketTypes:  { select: { id: true, label: true, price: true, receiptMode: true, ineligibleAmount: true } },
} satisfies Prisma.EvenementSelect

export type EvenementForTicketPayment = Prisma.EvenementGetPayload<{ select: typeof evenementTicketPaymentSelect }>

export function evenementHasFee(evenement: Pick<EvenementForTicketPayment, "price" | "ticketTypes">): boolean {
  return evenement.ticketTypes.length > 0 || (evenement.price != null && Number(evenement.price) > 0)
}

const INCOME_DESCRIPTION_METHOD_LABEL: Record<EvenementPaymentMethod, string> = {
  STRIPE:   "carte en ligne",
  ESPECES:  "espèces",
  CHEQUE:   "chèque",
  VIREMENT: "virement",
}

export async function markParticipationPaid(transaction: TxClient, params: {
  associationId: string
  evenement:     EvenementForTicketPayment
  participation: Participation
  ticketTypeId?: string
  paymentMethod?: EvenementPaymentMethod
  paidAt:        Date
  exerciceId:    string | null
}) {
  const { associationId, evenement, participation, ticketTypeId, paidAt, exerciceId } = params
  const hasTicketTypes = evenement.ticketTypes.length > 0

  if (!evenementHasFee(evenement)) throw new TicketPaymentError("Événement gratuit", 422)
  if (participation.ticketPaidAt) throw new TicketPaymentError("Déjà marqué comme payé", 409)

  // Which tier to charge: an explicit choice from the request wins (the "Encaisser" dialog in
  // the presences UI, for a walk-in that was never given one); otherwise fall back to whatever
  // this registration already picked (public form, portal purchase, or a previous manual
  // assignment); a single-tier event has no ambiguity so needs neither. More than one tier and
  // nothing resolved means the caller must pick — never guess.
  let tier: EvenementForTicketPayment["ticketTypes"][number] | undefined
  if (hasTicketTypes) {
    if (ticketTypeId) {
      tier = evenement.ticketTypes.find(ticketType => ticketType.id === ticketTypeId)
      if (!tier) throw new TicketPaymentError("Tarif invalide", 422)
    } else {
      // A stale ticketTypeId (tier deleted since) resolves to nothing — treated like no tier.
      tier = participation.ticketTypeId
        ? evenement.ticketTypes.find(ticketType => ticketType.id === participation.ticketTypeId)
        : undefined
      if (!tier && evenement.ticketTypes.length === 1) tier = evenement.ticketTypes[0]
      if (!tier) throw new TicketPaymentError("Sélectionnez un tarif", 422)
    }
  }
  // Un code promo a déjà été validé/appliqué à l'inscription (voir inscription/route.ts) —
  // recalculer ici depuis le prix de tarif ignorerait silencieusement la remise, même bug que
  // celui corrigé côté webhook Stripe (voir Participation.amount/discountCodeId dans
  // schema.prisma). Ignoré si l'admin réassigne explicitement une AUTRE tarif que celle
  // d'origine — le code n'a jamais été validé contre ce nouveau choix.
  const usesDiscountSnapshot = participation.discountCodeId != null && participation.amount != null
    && (!ticketTypeId || ticketTypeId === participation.ticketTypeId)
  const amount = usesDiscountSnapshot ? Number(participation.amount) : (hasTicketTypes ? Number(tier!.price) : Number(evenement.price))

  // Explicit choice from the manager wins. Otherwise a visitor who chose an offline method at
  // registration (see the public inscription route) already has it set here — respect that
  // instead of guessing. Only a walk-in with no prior selection falls back to espèces, exactly
  // as this flow always assumed.
  if (params.paymentMethod && !managerOnSitePaymentMethods(evenement).includes(params.paymentMethod as OnSitePaymentMethod))
    throw new TicketPaymentError("Ce moyen de paiement n'est pas accepté pour cet événement.", 422)
  const method = params.paymentMethod ?? participation.paymentMethod ?? "ESPECES"

  // Snapshotted from the tier at the moment of payment (see Participation.receiptMode in
  // schema.prisma) — an admin editing the tier's receipt settings later must not retroactively
  // change what receipt an already-paid ticket gets.
  const receiptMode      = tier?.receiptMode ?? "NONE"
  const deductibleAmount = eligibleReceiptAmount(amount, receiptMode, tier?.ineligibleAmount != null ? Number(tier.ineligibleAmount) : null)

  const updated = await transaction.participation.update({
    where: { id: participation.id },
    data:  { ticketPaidAt: paidAt, amount, ticketTypeId: tier?.id, paymentMethod: method, receiptMode, deductibleAmount },
  })

  const ticketLabel = evenement.ticketTypes.length > 1 && tier ? ` (${tier.label})` : ""
  await transaction.income.create({
    data: {
      associationId,
      exerciceId,
      memberId:        participation.membreId,
      participationId: participation.id,
      amount,
      paymentMethod: method,
      description:   `Billet (${INCOME_DESCRIPTION_METHOD_LABEL[method]}) — ${evenement.title}${ticketLabel} — ${participation.firstName} ${participation.lastName}`,
      source:        "MANUAL",
      status:        "PAID",
      date:          paidAt,
    },
  })

  return updated
}

export const onSitePaymentMethodSchema = z.enum(ON_SITE_PAYMENT_METHODS)

// Optional `payment` on the "Ajouter un invité" / "Ajouter un membre" requests — "now" records
// the payment in the same transaction as the creation, "later" reserves the seat (rsvp
// CONFIRME, shown "Réservé") so it counts against capacity until "Marquer payé".
export const doorPaymentSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("now"), ticketTypeId: z.string().min(1).optional(), paymentMethod: onSitePaymentMethodSchema }),
  z.object({ mode: z.literal("later") }),
])
export type DoorPayment = z.infer<typeof doorPaymentSchema>

// Same occupancy rule as every other capacity check (portal checkout/RSVP, promote, event
// PATCH): a seat is taken once paid or reserved.
export const occupiedSeatWhere = {
  OR: [{ ticketPaidAt: { not: null } }, { rsvp: "CONFIRME" }],
} satisfies Prisma.ParticipationWhereInput

export async function assertSeatAvailable(transaction: TxClient, params: {
  evenementId: string
  capacity:    number | null
  // The row being added/reserved, when it already exists — never counted against itself.
  participationId?: string
}) {
  if (params.capacity == null) return
  const occupied = await transaction.participation.count({
    where: {
      evenementId: params.evenementId,
      ...occupiedSeatWhere,
      ...(params.participationId ? { id: { not: params.participationId } } : {}),
    },
  })
  if (occupied + 1 > params.capacity) throw new TicketPaymentError("Capacité maximale atteinte", 422)
}

// Applies a door payment choice to a participation created (or found) in the same transaction.
export async function applyDoorPayment(transaction: TxClient, params: {
  associationId: string
  evenement:     EvenementForTicketPayment
  participation: Participation
  payment:       DoorPayment
  paidAt:        Date
  exerciceId:    string | null
}) {
  const { payment, participation } = params
  if (payment.mode === "now") {
    return markParticipationPaid(transaction, {
      associationId: params.associationId,
      evenement:     params.evenement,
      participation,
      ticketTypeId:  payment.ticketTypeId,
      paymentMethod: payment.paymentMethod,
      paidAt:        params.paidAt,
      exerciceId:    params.exerciceId,
    })
  }
  if (participation.ticketPaidAt || participation.rsvp === "CONFIRME") return participation
  return transaction.participation.update({
    where: { id: participation.id },
    data:  { rsvp: "CONFIRME", rsvpAt: params.paidAt },
  })
}
