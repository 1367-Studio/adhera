import type { Metadata } from "next"
import { APP_NAME } from "@/config/brand"
import { prisma } from "@/lib/prisma/client"
import { Badge } from "@/components/ui/badge"
import { NewPricingOfferButton, PricingOfferRowActions } from "@/components/backoffice/pricing-offer-client"

export const metadata: Metadata = {
  title: `Offres tarifaires · Backoffice ${APP_NAME}`,
}

const statusLabel: Record<string, { label: string; variant: "success" | "warning" | "outline" }> = {
  PENDING: { label: "En attente", variant: "warning" },
  USED:    { label: "Utilisée",   variant: "success" },
  EXPIRED: { label: "Expirée",    variant: "outline" },
  REVOKED: { label: "Révoquée",   variant: "outline" },
}

async function getOffers() {
  return prisma.pricingOffer.findMany({
    orderBy: { createdAt: "desc" },
    include: { association: { select: { name: true, slug: true } } },
  })
}

export default async function PricingOffersPage() {
  const offers = await getOffers()

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Offres tarifaires</h2>
          <p className="text-sm text-muted-foreground">
            {offers.length} offre{offers.length !== 1 ? "s" : ""} personnalisée{offers.length !== 1 ? "s" : ""}, liens d&apos;inscription à condition négociée, cas par cas.
          </p>
        </div>
        <NewPricingOfferButton />
      </div>

      <div className="rounded-lg border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr className="text-xs text-muted-foreground">
              <th className="text-left px-4 py-2.5 font-medium">Offre</th>
              <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">Plan</th>
              <th className="text-left px-4 py-2.5 font-medium hidden md:table-cell">Association</th>
              <th className="text-center px-4 py-2.5 font-medium">Statut</th>
              <th className="text-left px-4 py-2.5 font-medium hidden lg:table-cell">Créée le</th>
              <th className="text-right px-4 py-2.5 font-medium">Lien</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {offers.map(offer => {
              // The offer's own `status` column only ever flips PENDING → USED/REVOKED —
              // nothing sweeps it to EXPIRED once expiresAt passes (see the public lookup
              // route, which enforces expiry on read instead). Compute it here too, so the
              // list doesn't keep showing "En attente" for a link that's actually dead.
              const isExpired = offer.status === "PENDING" && offer.expiresAt !== null && offer.expiresAt < new Date()
              const effectiveStatus = isExpired ? "EXPIRED" : offer.status
              const status = statusLabel[effectiveStatus] ?? { label: effectiveStatus, variant: "outline" as const }
              return (
                <tr key={offer.id} className="hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3 font-medium">{offer.label}</td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                    {offer.planTier === "PRO" ? "Pro" : "Essentiel"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                    {offer.association?.name ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs hidden lg:table-cell">
                    {new Date(offer.createdAt).toLocaleDateString("fr-FR")}
                  </td>
                  <td className="px-4 py-3">
                    <PricingOfferRowActions id={offer.id} token={offer.token} status={effectiveStatus} />
                  </td>
                </tr>
              )
            })}
            {offers.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">
                  Aucune offre créée pour le moment.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
