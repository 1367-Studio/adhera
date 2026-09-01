"use client"

import { useEffect, useState, Suspense } from "react"
import { useQuery, useMutation } from "@tanstack/react-query"
import { useSearchParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { toast } from "sonner"
import { CheckCircleIcon, ClockIcon, CircleHalfIcon, GiftIcon, CreditCardIcon, DownloadSimpleIcon, WarningCircleIcon, XCircleIcon, ReceiptIcon } from "@phosphor-icons/react/dist/ssr";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { apiErrorMessage } from "@/lib/api-error"
import { portalFetch } from "@/lib/portal-fetch"
import { BASE_PATH } from "@/lib/env"
import { installmentCoverage as sharedInstallmentCoverage } from "@/lib/cotisation-display"

type Installment = { id: string; amount: string; dueDate: string }

type Cotisation = {
  id:         string
  year:       number
  amount:     string
  amountPaid: string
  status:     "EN_ATTENTE" | "PARTIELLEMENT_PAYEE" | "PAYE" | "EN_RETARD" | "EXONERE" | "ANNULEE"
  paidAt:     string | null
  note:       string | null
  declarationNumber: string | null
  receiptMode: "NONE" | "FULL" | "PARTIAL"
  deductibleAmount: string | null
  association: { canIssueTaxReceipts: boolean }
  installments: Installment[]
  // Server-computed (src/lib/cotisation-status.ts's nextAmountDue) — the amount that would
  // actually be charged right now, which is only the next unpaid échéance when a schedule
  // exists, not necessarily the whole remaining balance.
  amountDue:  number
}

const fmtEur = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

// Display-only — which échéances already look covered by payments received so far; the
// server remains the only source of truth for what's actually charged at checkout.
function installmentCoverage(installments: Installment[], amountPaid: number) {
  return sharedInstallmentCoverage(installments.map(i => ({ ...i, amount: Number(i.amount) })), amountPaid)
}

// Shared between the current-year card and each history card — a past-year cotisation can
// still have an unpaid/partially-paid installment schedule (e.g. EN_RETARD from a prior
// year), and hiding it there while showing it for the current year would be an inconsistent,
// confusing omission for exactly the cotisations most likely to need this context.
function InstallmentSchedule({ installments, amountPaid, t }: {
  installments: Installment[]
  amountPaid:   number
  t:            ReturnType<typeof useTranslations>
}) {
  if (installments.length === 0) return null
  return (
    <div className="space-y-1.5 rounded-lg border p-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("installmentsTitle")}</p>
      {installmentCoverage(installments, amountPaid).map(i => (
        <div key={i.id} className="flex items-center justify-between text-sm">
          <span>{format(new Date(i.dueDate), "d MMMM yyyy", { locale: fr })}</span>
          <div className="flex items-center gap-2">
            <span className="tabular-nums">{fmtEur(Number(i.amount))}</span>
            <Badge variant={i.covered ? "default" : "secondary"} className="text-xs">
              {i.covered ? t("installmentCovered") : t("installmentPending")}
            </Badge>
          </div>
        </div>
      ))}
    </div>
  )
}

const statusIcon: Record<string, React.ReactNode> = {
  EN_ATTENTE:          <ClockIcon className="size-3.5 text-yellow-500" />,
  PARTIELLEMENT_PAYEE: <CircleHalfIcon className="size-3.5 text-amber-500" />,
  PAYE:                <CheckCircleIcon className="size-3.5 text-green-500" />,
  EN_RETARD:           <WarningCircleIcon className="size-3.5 text-red-500" />,
  EXONERE:             <GiftIcon className="size-3.5 text-sky-500" />,
  ANNULEE:             <XCircleIcon className="size-3.5 text-muted-foreground" />,
}
const statusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  PAYE:                "default",
  EN_ATTENTE:          "secondary",
  PARTIELLEMENT_PAYEE: "outline",
  EN_RETARD:           "destructive",
  EXONERE:             "outline",
  ANNULEE:             "secondary",
}

function currentYear() {
  return new Date().getFullYear()
}

export default function CotisationPortalPage() {
  return (
    <Suspense fallback={null}>
      <CotisationPortalPageInner />
    </Suspense>
  )
}

function CotisationPortalPageInner() {
  const t             = useTranslations("portalMembre.cotisation")
  const tCommon       = useTranslations("common")
  const tTooltip      = useTranslations("cotisations.statusTooltip")
  const statusLabel: Record<string, string> = {
    EN_ATTENTE:          t("status.enAttente"),
    PARTIELLEMENT_PAYEE: t("status.partiellementPayee"),
    PAYE:                t("status.paye"),
    EN_RETARD:           t("status.enRetard"),
    EXONERE:             t("status.exonere"),
    ANNULEE:             t("status.annulee"),
  }
  const statusTooltip: Record<string, string> = {
    EN_ATTENTE:          tTooltip("enAttente"),
    PARTIELLEMENT_PAYEE: tTooltip("partiellementPayee"),
    PAYE:                tTooltip("paye"),
    EN_RETARD:           tTooltip("enRetard"),
    EXONERE:             tTooltip("exonere"),
    ANNULEE:             tTooltip("annulee"),
  }
  const searchParams = useSearchParams()
  const [paymentEnabled, setPaymentEnabled] = useState(false)
  // Distinct from paymentEnabled itself — without this, the "you can also pay another way"
  // disclaimer (which assumes an online option exists alongside it) would flash briefly on
  // load before the connect-status check resolves, since paymentEnabled starts false.
  const [paymentStatusLoaded, setPaymentStatusLoaded] = useState(false)

  const { data: cotisations, isLoading, isError, refetch } = useQuery<Cotisation[]>({
    queryKey: ["portal-cotisation"],
    queryFn:  () => portalFetch("/api/portal/cotisation") as Promise<Cotisation[]>,
    staleTime: 0,
  })

  useEffect(() => {
    fetch("/api/portal/connect-status")
      .then(r => r.json())
      .then((d: { enabled?: boolean }) => setPaymentEnabled(d.enabled === true))
      .catch(() => {})
      .finally(() => setPaymentStatusLoaded(true))
  }, [])

  useEffect(() => {
    const payment = searchParams.get("payment")
    if (payment === "success") {
      toast.success(t("toasts.paymentDone"))
      // The Stripe webhook that flips the cotisation to PAYE can lag slightly behind
      // this redirect — poll briefly instead of a single refetch that may still show EN_ATTENTE.
      let attempts = 0
      const poll = async () => {
        attempts++
        const result = await refetch()
        const stillPending = result.data?.some(c => c.year === currentYear() && (c.status === "EN_ATTENTE" || c.status === "PARTIELLEMENT_PAYEE" || c.status === "EN_RETARD"))
        if (stillPending && attempts < 5) setTimeout(poll, 1500)
      }
      poll()
    } else if (payment === "cancelled") {
      toast.info(t("toasts.paymentCancelled"))
    }
  }, [searchParams, refetch, t])

  const checkoutMutation = useMutation({
    mutationFn: async (cotisationId: string) => {
      const res = await fetch("/api/portal/cotisation/checkout", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ cotisationId }),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res, tCommon("error")))
      return res.json() as Promise<{ url: string }>
    },
    onSuccess: ({ url }) => { window.location.href = url },
    onError:   (err) => toast.error(err instanceof Error ? err.message : t("toasts.paymentError")),
  })

  // Fetch-and-save instead of window.open — a non-2xx response (fiscal receipts not enabled,
  // cotisation not eligible, etc.) would otherwise just open a new tab showing raw JSON instead
  // of any legible feedback, same reasoning the declaration button intentionally skips (it's
  // never shown unless declarationNumber already exists, so it can't 404).
  async function downloadRecu(cotisationId: string) {
    try {
      const res = await fetch(`${BASE_PATH}/api/portal/cotisation/${cotisationId}/recu`)
      if (!res.ok) {
        toast.error(await apiErrorMessage(res, tCommon("error")))
        return
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement("a")
      a.href = url
      a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? `recu-fiscal-${cotisationId}.pdf`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error(tCommon("error"))
    }
  }

  if (isLoading) {
    return (
      <div className="w-full space-y-6 animate-pulse">
        <div className="space-y-2">
          <div className="h-7 w-48 rounded bg-muted" />
          <div className="h-4 w-56 rounded bg-muted" />
        </div>
        <div className="rounded-lg border-2 p-6 space-y-4">
          <div className="h-5 w-48 rounded bg-muted" />
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <div className="h-8 w-24 rounded bg-muted" />
              <div className="h-3 w-32 rounded bg-muted" />
            </div>
            <div className="h-5 w-20 rounded-md bg-muted" />
          </div>
        </div>
        <div className="space-y-3">
          <div className="h-4 w-24 rounded bg-muted" />
          {[0, 1].map(i => (
            <div key={i} className="rounded-lg border p-4 flex items-center justify-between">
              <div className="space-y-1.5">
                <div className="h-4 w-20 rounded bg-muted" />
                <div className="h-3 w-28 rounded bg-muted" />
              </div>
              <div className="h-5 w-16 rounded-md bg-muted" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (isError) return <p className="text-sm text-muted-foreground py-8 text-center">{t("noMemberProfile")}</p>

  const list     = cotisations ?? []
  const thisYear = list.find(c => c.year === currentYear())
  const history  = list.filter(c => c.year !== currentYear())

  return (
    <div className="w-full space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t("subtitle")}</p>
      </div>

      {thisYear && (
        <Card className="border-2 border-sky-500/30 bg-sky-50/30 dark:bg-sky-950/20">
          <CardHeader>
            <CardTitle className="text-base text-sky-700 dark:text-sky-300">
              {t("currentYearTitle", { year: thisYear.year })}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-2xl font-bold">{parseFloat(thisYear.amount).toFixed(2)} €</p>
                {Number(thisYear.amountPaid) > 0 && Number(thisYear.amountPaid) < parseFloat(thisYear.amount) && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("remaining", { amount: `${(parseFloat(thisYear.amount) - Number(thisYear.amountPaid)).toFixed(2)} €` })}
                  </p>
                )}
                {thisYear.paidAt && (
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("paidOn", { date: format(new Date(thisYear.paidAt), "d MMMM yyyy", { locale: fr }) })}
                  </p>
                )}
                {thisYear.note && (
                  <p className="text-xs text-muted-foreground mt-0.5 italic">{thisYear.note}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger render={<span className="inline-flex" />}>
                    <Badge variant={statusVariant[thisYear.status]} className="gap-1.5">
                      {statusIcon[thisYear.status]}
                      {statusLabel[thisYear.status]}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>{statusTooltip[thisYear.status]}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              {thisYear.declarationNumber && (
                <Button
                size="sm"
                variant="ghost"
                className="hover:bg-muted/10"
                onClick={() => window.open(`${BASE_PATH}/api/portal/cotisation/${thisYear.id}/declaration`)}
                >
                  <DownloadSimpleIcon className="size-3.5" />
                </Button>
              )}
              {thisYear.receiptMode !== "NONE" && thisYear.paidAt && thisYear.association.canIssueTaxReceipts && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger render={
                      <Button size="sm" variant="ghost" className="hover:bg-muted/10" onClick={() => downloadRecu(thisYear.id)}>
                        <ReceiptIcon className="size-3.5" />
                      </Button>
                    } />
                    <TooltipContent>
                      {thisYear.receiptMode === "PARTIAL" && thisYear.deductibleAmount
                        ? t("downloadRecuFiscalPartial", { amount: fmtEur(Number(thisYear.deductibleAmount)) })
                        : t("downloadRecuFiscal")}
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}
              </div>
            </div>

            <InstallmentSchedule installments={thisYear.installments} amountPaid={Number(thisYear.amountPaid)} t={t} />

            {(thisYear.status === "EN_ATTENTE" || thisYear.status === "PARTIELLEMENT_PAYEE" || thisYear.status === "EN_RETARD") && paymentStatusLoaded && (
              <div className="space-y-2">
                {paymentEnabled && (
                  <Button
                    size="sm"
                    onClick={() => checkoutMutation.mutate(thisYear.id)}
                    loading={checkoutMutation.isPending}
                    className="gap-1.5"
                  >
                    <CreditCardIcon className="size-3.5" />
                    {t("payAmount", { amount: fmtEur(thisYear.amountDue) })}
                  </Button>
                )}
                <p className="text-xs text-muted-foreground">
                  {paymentEnabled ? t("otherPaymentMethodsNotice") : t("offlinePaymentNotice")}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">{t("history")}</h2>

        {history.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            {t("noHistory")}
          </p>
        ) : (
          history.map(c => {
            // ANNULEE deliberately excluded — a cancelled cotisation shouldn't prompt the
            // member to pay it.
            const owesSomething = c.status === "EN_ATTENTE" || c.status === "PARTIELLEMENT_PAYEE" || c.status === "EN_RETARD"
            return (
            <Card key={c.id}>
              <CardContent className="py-4 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-sm">{t("yearLabel", { year: c.year })}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {parseFloat(c.amount).toFixed(2)} €
                      {Number(c.amountPaid) > 0 && Number(c.amountPaid) < parseFloat(c.amount) && (
                        <span className="ml-2">
                          {t("remaining", { amount: `${(parseFloat(c.amount) - Number(c.amountPaid)).toFixed(2)} €` })}
                        </span>
                      )}
                      {c.paidAt && (
                        <span className="ml-2">
                          {t("paidOnShort", { date: format(new Date(c.paidAt), "d MMM yyyy", { locale: fr }) })}
                        </span>
                      )}
                    </p>
                    {c.note && <p className="text-xs text-muted-foreground italic mt-0.5">{c.note}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger render={<span className="inline-flex" />}>
                          <Badge variant={statusVariant[c.status]} className="gap-1">
                            {statusIcon[c.status]}
                            {statusLabel[c.status]}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>{statusTooltip[c.status]}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    {c.declarationNumber && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => window.open(`${BASE_PATH}/api/portal/cotisation/${c.id}/declaration`)}
                      >
                        <DownloadSimpleIcon className="size-3.5" />
                      </Button>
                    )}
                    {c.receiptMode !== "NONE" && c.paidAt && c.association.canIssueTaxReceipts && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger render={
                            <Button size="sm" variant="outline" onClick={() => downloadRecu(c.id)}>
                              <ReceiptIcon className="size-3.5" />
                            </Button>
                          } />
                          <TooltipContent>
                            {c.receiptMode === "PARTIAL" && c.deductibleAmount
                              ? t("downloadRecuFiscalPartial", { amount: fmtEur(Number(c.deductibleAmount)) })
                              : t("downloadRecuFiscal")}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    {owesSomething && paymentEnabled && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => checkoutMutation.mutate(c.id)}
                        loading={checkoutMutation.isPending}
                      >
                        <CreditCardIcon className="size-3.5 mr-1" />
                        {t("payAmount", { amount: fmtEur(c.amountDue) })}
                      </Button>
                    )}
                  </div>
                </div>
                <InstallmentSchedule installments={c.installments} amountPaid={Number(c.amountPaid)} t={t} />
                {owesSomething && paymentStatusLoaded && (
                  <p className="text-xs text-muted-foreground">
                    {paymentEnabled ? t("otherPaymentMethodsNotice") : t("offlinePaymentNotice")}
                  </p>
                )}
              </CardContent>
            </Card>
            )
          })
        )}
      </section>
    </div>
  )
}
