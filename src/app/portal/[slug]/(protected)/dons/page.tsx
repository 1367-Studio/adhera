"use client"

import { useEffect, useState, Suspense } from "react"
import { useQuery } from "@tanstack/react-query"
import { useSearchParams, useParams } from "next/navigation"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { toast } from "sonner"
import { HandshakeIcon, DownloadSimpleIcon, CheckCircleIcon, ClockIcon } from "@phosphor-icons/react/dist/ssr";
import { portalFetch } from "@/lib/portal-fetch"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { BASE_PATH } from "@/lib/env"

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
  return (
    <Suspense fallback={null}>
      <DonsPortalPageInner />
    </Suspense>
  )
}

function DonsPortalPageInner() {
  const { slug }       = useParams<{ slug: string }>()
  const searchParams   = useSearchParams()

  // Coming back from Stripe just after paying — the webhook that actually flips the don
  // to "payé" can lag a few seconds behind the redirect, so poll briefly instead of
  // leaving it showing "En attente" right under a "Merci pour votre don !" toast.
  const [polling, setPolling] = useState(false)

  const { data: dons = [], isLoading, refetch } = useQuery<Don[]>({
    queryKey: ["portal-dons"],
    queryFn:  () => portalFetch("/api/portal/dons") as Promise<Don[]>,
    staleTime: 0,
    refetchInterval: polling ? 2000 : false,
  })

  useEffect(() => {
    const p = searchParams.get("payment")
    if (p === "success") {
      toast.success("Merci pour votre don ! Un e-mail de confirmation vous a été envoyé.")
      setPolling(true)
      refetch()
    } else if (p === "cancelled") {
      toast.info("Don annulé.")
    }
  }, [searchParams, refetch])

  useEffect(() => {
    if (!polling) return
    const t = setTimeout(() => setPolling(false), 20_000)
    return () => clearTimeout(t)
  }, [polling])

  // Stop as soon as the webhook actually lands instead of always riding out the full
  // 20s — dons are ordered newest-first, so the most recent one is the one just paid.
  useEffect(() => {
    if (polling && dons[0]?.paidAt) setPolling(false)
  }, [polling, dons])

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
          onClick={() => window.location.href = `${BASE_PATH}/portal/${slug}/dons/nouveau`}
          className="gap-1.5 bg-violet-600 hover:bg-violet-700 text-white shrink-0"
        >
          <HandshakeIcon className="size-3.5" />
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
          <HandshakeIcon className="size-8 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">Vous n'avez pas encore effectué de don.</p>
          <Button
            size="sm"
            variant="outline"
            onClick={() => window.location.href = `${BASE_PATH}/portal/${slug}/dons/nouveau`}
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
                      <DownloadSimpleIcon className="size-3.5" />
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
