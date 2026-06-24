"use client"

import { useEffect, useState } from "react"
import { useQuery, useMutation } from "@tanstack/react-query"
import { useSearchParams } from "next/navigation"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { toast } from "sonner"
import { CheckCircleIcon, ClockIcon, GiftIcon, CreditCardIcon } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { apiErrorMessage } from "@/lib/api-error"

type Cotisation = {
  id:      string
  year:    number
  amount:  string
  status:  "EN_ATTENTE" | "PAYE" | "EXONERE"
  paidAt:  string | null
  note:    string | null
}

const statusLabel: Record<string, string> = {
  EN_ATTENTE: "En attente",
  PAYE:       "Payé",
  EXONERE:    "Exonéré",
}
const statusIcon: Record<string, React.ReactNode> = {
  EN_ATTENTE: <ClockIcon className="size-3.5 text-yellow-500" />,
  PAYE:       <CheckCircleIcon className="size-3.5 text-green-500" />,
  EXONERE:    <GiftIcon className="size-3.5 text-sky-500" />,
}
const statusVariant: Record<string, "default" | "secondary" | "outline"> = {
  PAYE:       "default",
  EN_ATTENTE: "secondary",
  EXONERE:    "outline",
}

function currentYear() {
  return new Date().getFullYear()
}

export default function CotisationPortalPage() {
  const searchParams = useSearchParams()
  const [paymentEnabled, setPaymentEnabled] = useState(false)

  const { data: cotisations, isLoading, refetch } = useQuery<Cotisation[]>({
    queryKey: ["portal-cotisation"],
    queryFn:  () => fetch("/api/portal/cotisation").then(r => r.json()),
  })

  useEffect(() => {
    fetch("/api/portal/connect-status")
      .then(r => r.json())
      .then((d: { enabled?: boolean }) => setPaymentEnabled(d.enabled === true))
      .catch(() => {})
  }, [])

  useEffect(() => {
    const payment = searchParams.get("payment")
    if (payment === "success") {
      toast.success("Paiement effectué ! Votre cotisation est maintenant réglée.")
      refetch()
    } else if (payment === "cancelled") {
      toast.info("Paiement annulé.")
    }
  }, [searchParams, refetch])

  const checkoutMutation = useMutation({
    mutationFn: async (cotisationId: string) => {
      const res = await fetch("/api/portal/cotisation/checkout", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ cotisationId }),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res, "Erreur"))
      return res.json() as Promise<{ url: string }>
    },
    onSuccess: ({ url }) => { window.location.href = url },
    onError:   (err) => toast.error(err instanceof Error ? err.message : "Erreur lors du paiement"),
  })

  if (isLoading) {
    return (
      <div className="w-full space-y-6 animate-pulse">
        <div className="space-y-2">
          <div className="h-7 w-48 rounded bg-muted" />
          <div className="h-4 w-56 rounded bg-muted" />
        </div>
        <div className="rounded-xl border-2 p-6 space-y-4">
          <div className="h-5 w-48 rounded bg-muted" />
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <div className="h-8 w-24 rounded bg-muted" />
              <div className="h-3 w-32 rounded bg-muted" />
            </div>
            <div className="h-6 w-20 rounded-full bg-muted" />
          </div>
        </div>
        <div className="space-y-3">
          <div className="h-4 w-24 rounded bg-muted" />
          {[0, 1].map(i => (
            <div key={i} className="rounded-xl border p-4 flex items-center justify-between">
              <div className="space-y-1.5">
                <div className="h-4 w-20 rounded bg-muted" />
                <div className="h-3 w-28 rounded bg-muted" />
              </div>
              <div className="h-6 w-16 rounded-full bg-muted" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  const list     = cotisations ?? []
  const thisYear = list.find(c => c.year === currentYear())
  const history  = list.filter(c => c.year !== currentYear())

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Ma cotisation</h1>
        <p className="text-muted-foreground text-sm mt-1">Suivi de vos paiements annuels.</p>
      </div>

      {thisYear && (
        <Card className="border-2 border-sky-500/30 bg-sky-50/30 dark:bg-sky-950/20">
          <CardHeader>
            <CardTitle className="text-base text-sky-700 dark:text-sky-300">
              Cotisation {thisYear.year} — Année en cours
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{parseFloat(thisYear.amount).toFixed(2)} €</p>
                {thisYear.paidAt && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Payé le {format(new Date(thisYear.paidAt), "d MMMM yyyy", { locale: fr })}
                  </p>
                )}
                {thisYear.note && (
                  <p className="text-xs text-muted-foreground mt-0.5 italic">{thisYear.note}</p>
                )}
              </div>
              <Badge variant={statusVariant[thisYear.status]} className="gap-1.5">
                {statusIcon[thisYear.status]}
                {statusLabel[thisYear.status]}
              </Badge>
            </div>

            {thisYear.status === "EN_ATTENTE" && paymentEnabled && (
              <Button
                size="sm"
                onClick={() => checkoutMutation.mutate(thisYear.id)}
                loading={checkoutMutation.isPending}
                className="gap-1.5"
              >
                <CreditCardIcon className="size-3.5" />
                Payer en ligne
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Historique</h2>

        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
            Aucun historique disponible.
          </p>
        ) : (
          history.map(c => (
            <Card key={c.id}>
              <CardContent className="py-4 flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-sm">Année {c.year}</p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {parseFloat(c.amount).toFixed(2)} €
                    {c.paidAt && (
                      <span className="ml-2">
                        · payé le {format(new Date(c.paidAt), "d MMM yyyy", { locale: fr })}
                      </span>
                    )}
                  </p>
                  {c.note && <p className="text-xs text-muted-foreground italic mt-0.5">{c.note}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant={statusVariant[c.status]} className="gap-1">
                    {statusIcon[c.status]}
                    {statusLabel[c.status]}
                  </Badge>
                  {c.status === "EN_ATTENTE" && paymentEnabled && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => checkoutMutation.mutate(c.id)}
                      loading={checkoutMutation.isPending}
                    >
                      <CreditCardIcon className="size-3.5 mr-1" />
                      Payer
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </section>
    </div>
  )
}
