"use client"

import { useEffect } from "react"
import { useQuery } from "@tanstack/react-query"
import { useSearchParams, useParams } from "next/navigation"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { toast } from "sonner"
import { HeartHandshakeIcon, DownloadIcon, CheckCircleIcon, ClockIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type Don = {
  id:              string
  amount:          string
  message:         string | null
  anonymous:       boolean
  paidAt:          string | null
  createdAt:       string
  receiptNumber:   string | null
  receiptIssuedAt: string | null
  association:     { canIssueTaxReceipts: boolean }
}

export default function DonsPortalPage() {
  const { slug }       = useParams<{ slug: string }>()
  const searchParams   = useSearchParams()

  const { data: dons = [], isLoading, refetch } = useQuery<Don[]>({
    queryKey: ["portal-dons"],
    queryFn:  () => fetch("/api/portal/dons").then(r => r.json()),
    staleTime: 0,
  })

  useEffect(() => {
    const p = searchParams.get("payment")
    if (p === "success") {
      toast.success("Merci pour votre don ! Un e-mail de confirmation vous a été envoyé.")
      refetch()
    } else if (p === "cancelled") {
      toast.info("Don annulé.")
    }
  }, [searchParams, refetch])

  const canIssueReceipts = dons[0]?.association.canIssueTaxReceipts ?? false

  function downloadRecu(donId: string) {
    window.open(`/api/portal/dons/${donId}/recu`, "_blank")
  }

  return (
    <div className="w-full space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Mes dons</h1>
          <p className="text-muted-foreground text-sm mt-1">Historique de vos contributions.</p>
        </div>
        <Button
          size="sm"
          onClick={() => window.location.href = `/portal/${slug}/don`}
          className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white shrink-0"
        >
          <HeartHandshakeIcon className="size-3.5" />
          Faire un don
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="rounded-xl border p-4 animate-pulse">
              <div className="h-4 w-24 bg-muted rounded mb-2" />
              <div className="h-6 w-16 bg-muted rounded" />
            </div>
          ))}
        </div>
      ) : dons.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center space-y-3">
          <HeartHandshakeIcon className="size-8 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">Vous n'avez pas encore effectué de don.</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.location.href = `/portal/${slug}/don`}
          >
            Faire mon premier don
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {dons.map(don => {
            const paid   = !!don.paidAt
            const amount = parseFloat(don.amount).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

            return (
              <Card key={don.id}>
                <CardContent className="py-4 flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-base">{amount}</span>
                      <Badge variant={paid ? "default" : "secondary"} className="gap-1">
                        {paid
                          ? <><CheckCircleIcon className="size-3" />Reçu</>
                          : <><ClockIcon className="size-3" />En attente</>}
                      </Badge>
                    </div>
                    {don.paidAt && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {format(new Date(don.paidAt), "d MMMM yyyy", { locale: fr })}
                      </p>
                    )}
                    {don.message && (
                      <p className="text-xs text-muted-foreground italic mt-0.5 truncate max-w-xs">
                        « {don.message} »
                      </p>
                    )}
                  </div>

                  {paid && canIssueReceipts && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => downloadRecu(don.id)}
                      className="gap-1.5 shrink-0"
                    >
                      <DownloadIcon className="size-3.5" />
                      Reçu fiscal
                    </Button>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {canIssueReceipts && dons.some(d => d.paidAt) && (
        <p className="text-xs text-muted-foreground text-center">
          Vos reçus fiscaux vous permettent de bénéficier d'une réduction d'impôt (Art. 200 CGI).
        </p>
      )}
    </div>
  )
}
