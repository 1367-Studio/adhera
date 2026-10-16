import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { donNewDonationAdminEmail } from "@/lib/email"
import { pusherServer } from "@/lib/pusher-server"
import { reportError } from "@/lib/monitoring"
import { APP_URL } from "@/lib/env"
import { resolveDonResponsable } from "@/lib/dons/responsable"
import { resolveEmailBranding } from "@/lib/plan-limits"

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  STRIPE: "Carte bancaire (en ligne)", ESPECES: "Espèces", CHEQUE: "Chèque", VIREMENT: "Virement", AUTRE: "Autre",
}

// Notifies Association.donResponsable (in-app + e-mail) that a don was registered — called
// once per don, exactly once, from whichever path first knows its final state at submission
// time: the public offline checkout (status "À recevoir", nothing paid yet), the Stripe
// webhook once checkout.session.completed actually lands (status "Reçu"), or the manual-entry
// route when the admin opts in. Never called a second time for the same don (e.g. when an
// admin later encaisses an offline don) — one alert per don is the contract, not one per
// state transition. A no-op when no responsable is configured.
export async function notifyDonResponsable(params: {
  associationId:   string
  donId:           string
  donorLabel:      string
  amount:          number
  paymentMethod:   string
  paidAt:          boolean // true once the money has actually landed, false while "à recevoir"
}): Promise<void> {
  const responsable = await resolveDonResponsable(params.associationId)
  if (!responsable) return

  const statusLabel = params.paidAt ? "Reçu" : "À recevoir"
  const link         = `/dashboard/dons?donId=${params.donId}`

  await prisma.notification.create({
    data: {
      userId: responsable.id,
      title:  "Nouveau don",
      body:   `${params.donorLabel} a fait un don de ${params.amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })} — ${statusLabel}`,
      link,
      scope:  "GESTION",
    },
  })
  await pusherServer.trigger(`private-association-${params.associationId}`, "new-notification", {})
    .catch((error: unknown) => reportError(error, { area: "api", action: "dons.notify-responsable-pusher", extra: { associationId: params.associationId, donId: params.donId } }))

  const assoc = await prisma.association.findUnique({ where: { id: params.associationId }, select: { name: true } })
  if (!assoc) return

  const branding = await resolveEmailBranding(params.associationId)

  sendEmail(donNewDonationAdminEmail({
    email:              responsable.email,
    associationName:    assoc.name,
    donorLabel:         params.donorLabel,
    amount:             params.amount,
    paymentMethodLabel: PAYMENT_METHOD_LABEL[params.paymentMethod] ?? params.paymentMethod,
    statusLabel,
    dashboardUrl:       `${APP_URL}${link}`,
    branding,
  }), { associationId: params.associationId, source: "DON_ADMIN_ALERT", sourceId: params.donId })
    .catch(error => reportError(error, { area: "email", action: "dons.notify-responsable-email", extra: { associationId: params.associationId, donId: params.donId } }))
}

// Thin fan-out over notifyDonResponsable for a don embarqué on a membership signup or event
// registration (createMembershipAddonPurchases/createEvenementDonation) — there's normally
// just one, but a group order or a multi-line addons picker can produce more than one Don in
// the same transaction. Call only after the transaction that created them has committed (see
// those functions' own comments) — never from inside it, or a rolled-back signup would still
// have alerted the responsable about a don that no longer exists.
export function notifyNewAddonDonations(
  associationId: string,
  donorLabel:    string,
  donations:     { id: string; amount: number; paymentMethod: string; paidAt: Date | null }[],
): void {
  for (const don of donations) {
    notifyDonResponsable({
      associationId, donId: don.id, donorLabel,
      amount: don.amount, paymentMethod: don.paymentMethod, paidAt: don.paidAt != null,
    }).catch(error => reportError(error, { area: "api", action: "dons.notify-addon-responsable", extra: { associationId, donId: don.id } }))
  }
}
