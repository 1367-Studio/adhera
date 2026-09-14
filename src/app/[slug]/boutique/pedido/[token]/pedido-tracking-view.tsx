"use client"

import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { CheckCircleIcon, ClockIcon, XCircleIcon, ShoppingBagIcon } from "@phosphor-icons/react/dist/ssr";
import { Badge } from "@/components/ui/badge"

type Pedido = {
  status:          "PENDING" | "PAID" | "CANCELLED"
  guestName:       string | null
  totalAmount:     number
  paymentMethod:   "STRIPE" | "MANUAL"
  receiptNumber:   string | null
  createdAt:       string
  paidAt:          string | null
  associationName: string
  items:           { name: string; quantity: number; unitPrice: number }[]
}

type Props = { slug: string; token: string }

export function PedidoTrackingView({ slug, token }: Props) {
  const t = useTranslations("portalMembre.boutique")

  const { data, isLoading, error } = useQuery<Pedido>({
    queryKey: ["public-boutique-pedido", slug, token],
    queryFn:  () => fetch(`/api/public/${slug}/boutique/pedido/${token}`).then(async r => {
      if (!r.ok) throw new Error("not-found")
      return r.json()
    }),
  })

  const fmt = (c: number) => (c / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

  if (isLoading) return <div className="min-h-screen bg-background" />

  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center text-center px-4 gap-2">
        <p className="text-lg font-semibold">{t("trackingNotFound")}</p>
      </div>
    )
  }

  const statusInfo = {
    PENDING:   { label: t("trackingStatusPending"),   icon: ClockIcon,       badge: "warning" as const },
    PAID:      { label: t("trackingStatusPaid"),      icon: CheckCircleIcon, badge: "success" as const },
    CANCELLED: { label: t("trackingStatusCancelled"), icon: XCircleIcon,     badge: "outline" as const },
  }[data.status]

  return (
    <div className="min-h-screen bg-background py-10 px-4">
      <div className="max-w-lg mx-auto space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center size-12 rounded-full bg-primary/10 dark:bg-primary/20">
            <ShoppingBagIcon className="size-6 text-primary" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{t("trackingPageTitle")}</h1>
          <p className="text-sm text-muted-foreground">{data.associationName}</p>
        </div>

        <div className="rounded-lg border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between">
            <Badge variant={statusInfo.badge} className="gap-1.5">
              <statusInfo.icon className="size-3.5" />
              {statusInfo.label}
            </Badge>
            {data.receiptNumber && <span className="text-xs text-muted-foreground">{data.receiptNumber}</span>}
          </div>

          <div className="space-y-2 text-sm">
            {data.items.map((item, i) => (
              <div key={i} className="flex justify-between text-muted-foreground">
                <span className="truncate mr-2">{item.name} ({item.quantity}×)</span>
                <span className="shrink-0 tabular-nums">{fmt(item.unitPrice * item.quantity)}</span>
              </div>
            ))}
          </div>

          <div className="border-t pt-3 flex justify-between font-semibold">
            <span>{t("total")}</span>
            <span className="tabular-nums text-primary">{fmt(data.totalAmount)}</span>
          </div>

          {data.status === "PENDING" && data.paymentMethod === "MANUAL" && (
            <p className="text-xs text-muted-foreground">{t("paymentManualHint")}</p>
          )}
        </div>
      </div>
    </div>
  )
}
