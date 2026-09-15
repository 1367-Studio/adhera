"use client"

import { useEffect, useState, Suspense } from "react"
import { useQuery } from "@tanstack/react-query"
import { useSearchParams, useParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { toast } from "sonner"
import { HandshakeIcon, DownloadSimpleIcon, CheckCircleIcon, ClockIcon } from "@phosphor-icons/react/dist/ssr";
import { portalFetch } from "@/lib/portal-fetch"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { BASE_PATH } from "@/lib/env"
import { cn } from "@/lib/utils"

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

type DonationCampaign = {
  id:          string
  slug:        string
  title:       string
  description: string | null
  imageUrl:    string | null
  notOpenYet:  boolean
  closed:      boolean
}

export default function DonsPortalPage() {
  return (
    <Suspense fallback={null}>
      <DonsPortalPageInner />
    </Suspense>
  )
}

function DonsPortalPageInner() {
  const t              = useTranslations("portalMembre.dons")
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

  // Seules les campagnes effectivement publiées par le responsable en Gestion apparaissent
  // ici — jamais de formulaire générique par défaut (voir /api/portal/dons/forms).
  const { data: campaigns = [], isLoading: loadingCampaigns, isError: campaignsError } = useQuery<DonationCampaign[]>({
    queryKey: ["portal-dons-forms"],
    queryFn:  () => portalFetch("/api/portal/dons/forms") as Promise<DonationCampaign[]>,
  })

  useEffect(() => {
    const p = searchParams.get("payment")
    if (p === "success") {
      toast.success(t("toasts.thanked"))
      setPolling(true)
      refetch()
    } else if (p === "cancelled") {
      toast.info(t("toasts.cancelled"))
    }
  }, [searchParams, refetch, t])

  useEffect(() => {
    if (!polling) return
    const timeoutId = setTimeout(() => setPolling(false), 20_000)
    return () => clearTimeout(timeoutId)
  }, [polling])

  // Stop as soon as the webhook actually lands instead of always riding out the full
  // 20s — dons are ordered newest-first, so the most recent one is the one just paid.
  useEffect(() => {
    if (polling && dons[0]?.paidAt) setPolling(false)
  }, [polling, dons])

  const canIssueReceipts = dons[0]?.association.canIssueTaxReceipts ?? false

  function downloadRecu(donId: string) {
    window.open(`${BASE_PATH}/api/portal/dons/${donId}/recu`, "_blank")
  }

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t("subtitle")}</p>
      </div>

      {/* Une campagne = un DonationForm publié en Gestion. Rien ici tant qu'aucune n'a été
          publiée — pas de repli sur un formulaire générique. Une campagne pas encore ouverte
          ou tout juste terminée reste listée (avec son propre badge) plutôt que de disparaître
          sans laisser de trace. */}
      {campaignsError ? (
        <p className="text-sm text-muted-foreground">{t("loadCampaignsError")}</p>
      ) : !loadingCampaigns && campaigns.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">{t("campaignsHeading")}</h2>
          <div className={cn("grid grid-cols-1 gap-4", campaigns.length > 1 && "sm:grid-cols-2")}>
            {campaigns.map(c => (
              <Card key={c.id} className="overflow-hidden">
                {c.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.imageUrl} alt="" className="aspect-[3/1] w-full object-cover" />
                )}
                <CardContent className="p-4 space-y-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{c.title}</p>
                      {c.notOpenYet && <Badge variant="warning">{t("comingSoon")}</Badge>}
                      {c.closed && <Badge variant="outline">{t("campaignClosed")}</Badge>}
                    </div>
                    {c.description && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{c.description}</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    disabled={c.notOpenYet || c.closed}
                    onClick={() => window.location.href = `${BASE_PATH}/portal/${slug}/dons/${c.slug}`}
                    className="gap-1.5"
                  >
                    <HandshakeIcon className="size-3.5" />
                    {t("makeDonation")}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map(i => (
            <div key={i} className="rounded-lg border p-4 animate-pulse">
              <div className="h-4 w-24 bg-muted rounded mb-2" />
              <div className="h-6 w-16 bg-muted rounded" />
            </div>
          ))}
        </div>
      ) : dons.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center space-y-3">
          <HandshakeIcon className="size-8 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">{t("noneYet")}</p>
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
                          ? <><CheckCircleIcon className="size-3" />{t("received")}</>
                          : <><ClockIcon className="size-3" />{t("pending")}</>}
                      </Badge>
                    </div>
                    {don.paidAt && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {format(new Date(don.paidAt), "d MMMM yyyy", { locale: fr })}
                      </p>
                    )}
                    {don.message && (
                      <p className="text-xs text-muted-foreground italic mt-0.5 truncate max-w-xs">
                        {t("messageQuote", { message: don.message })}
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
                      {t("taxReceipt")}
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
          {t("taxReceiptHint")}
        </p>
      )}
    </div>
  )
}
