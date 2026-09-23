// Client-safe (no Prisma import) — shared by the presences page, the public registration
// form and the server routes that record an on-site ticket payment.

// Every EvenementPaymentMethod a manager can record at the door — STRIPE excluded, it's only
// ever written by the online checkout webhook.
export const ON_SITE_PAYMENT_METHODS = ["ESPECES", "CHEQUE", "VIREMENT"] as const
export type OnSitePaymentMethod = (typeof ON_SITE_PAYMENT_METHODS)[number]

export interface EvenementAcceptedMethods {
  allowCash?:     boolean | null
  allowCheque?:   boolean | null
  allowTransfer?: boolean | null
}

export function isOnSitePaymentMethodAccepted(method: OnSitePaymentMethod, evenement: EvenementAcceptedMethods): boolean {
  switch (method) {
    case "ESPECES":  return !!evenement.allowCash
    case "CHEQUE":   return !!evenement.allowCheque
    case "VIREMENT": return !!evenement.allowTransfer
  }
}

// Methods the event opted into on its "Paiement" step, in display order.
export function acceptedOnSitePaymentMethods(evenement: EvenementAcceptedMethods): OnSitePaymentMethod[] {
  return ON_SITE_PAYMENT_METHODS.filter(method => isOnSitePaymentMethodAccepted(method, evenement))
}

// What the manager can pick when recording a payment at the door: the accepted methods, or all
// three when the event accepts none of them (online-only event, someone still pays on site).
export function managerOnSitePaymentMethods(evenement: EvenementAcceptedMethods): OnSitePaymentMethod[] {
  const accepted = acceptedOnSitePaymentMethods(evenement)
  return accepted.length > 0 ? accepted : [...ON_SITE_PAYMENT_METHODS]
}
