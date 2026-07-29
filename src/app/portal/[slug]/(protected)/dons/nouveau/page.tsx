"use client"

import { useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { HandshakeIcon, InfoIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { CurrencyInput } from "@/components/ui/currency-field"
import { portalFetch } from "@/lib/portal-fetch"
import { cn } from "@/lib/utils"

const SUGGESTED = [10, 20, 50, 100]

type AssocInfo = {
  name:                string
  canIssueTaxReceipts: boolean
  paymentEnabled:      boolean
  hasEmail:            boolean
  hasAddress:          boolean
}

export default function NouveauDonPage() {
  const t        = useTranslations("portalMembre.dons")
  const tCommon  = useTranslations("common")
  const { slug } = useParams<{ slug: string }>()
  const router   = useRouter()

  const { data: assoc, isLoading: loadingAssoc, isError: assocError } = useQuery<AssocInfo>({
    queryKey: ["portal-dons-checkout-info"],
    queryFn:  () => portalFetch("/api/portal/dons/checkout") as Promise<AssocInfo>,
  })

  const [amount, setAmount]       = useState(0)
  const [message, setMessage]     = useState("")
  const [anonymous, setAnonymous] = useState(false)
  const [loading, setLoading]     = useState(false)

  const canSubmit = !loading && amount > 0 && assoc?.paymentEnabled && assoc?.hasEmail

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return
    setLoading(true)
    try {
      const res = await fetch("/api/portal/dons/checkout", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount,
          message:   message.trim() || undefined,
          anonymous,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? tCommon("error")); return }
      window.location.href = data.url
    } catch {
      toast.error(tCommon("networkError"))
    } finally {
      setLoading(false)
    }
  }

  if (loadingAssoc) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="size-6 rounded-full border-2 border-violet-600 border-t-transparent animate-spin" />
      </div>
    )
  }

  return (
    <div className="w-full max-w-md mx-auto space-y-6">
      <div className="text-center space-y-2">
        <div className="inline-flex items-center justify-center size-12 rounded-full bg-violet-100 dark:bg-violet-900/30 mb-2">
          <HandshakeIcon className="size-6 text-violet-600 dark:text-violet-400" />
        </div>
        <h1 className="text-2xl font-bold tracking-tight">{t("makeDonation")}</h1>
        {assoc?.name && (
          <p className="text-muted-foreground text-sm">{t("toWhom", { name: assoc.name })}</p>
        )}
      </div>

      {assoc?.canIssueTaxReceipts && (
        <div className="rounded-xl border border-violet-200 bg-violet-50/80 dark:bg-violet-950/20 p-4 flex gap-3">
          <InfoIcon className="size-4 text-violet-600 shrink-0 mt-0.5" />
          <div className="text-sm text-violet-800 dark:text-violet-300 space-y-1">
            <p className="font-semibold">{t("taxDeductibleTitle")}</p>
            <p className="text-xs text-violet-700 dark:text-violet-400">
              {t("taxDeductibleDetail")}
            </p>
          </div>
        </div>
      )}

      {assoc?.canIssueTaxReceipts && assoc.hasEmail && !assoc.hasAddress && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/80 dark:bg-amber-950/20 p-4 flex gap-3">
          <WarningCircleIcon className="size-4 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800 dark:text-amber-300 space-y-1">
            <p>
              {t("noAddressWarning")}{" "}
              <Link href={`/portal/${slug}/profil`} className="underline underline-offset-2">
                {t("completeProfile")}
              </Link>
            </p>
          </div>
        </div>
      )}

      {assocError ? (
        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("checkAvailabilityError")}
        </div>
      ) : assoc && !assoc.hasEmail ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50/80 dark:bg-amber-950/20 p-6 text-center space-y-3">
          <WarningCircleIcon className="size-6 text-amber-600 mx-auto" />
          <p className="text-sm text-amber-800 dark:text-amber-300">
            {t("addEmailPrompt")}
          </p>
          <Button size="sm" onClick={() => router.push(`/portal/${slug}/profil`)}>
            {t("completeProfile")}
          </Button>
        </div>
      ) : !assoc?.paymentEnabled ? (
        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          {t("paymentUnavailable")}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="rounded-xl border bg-card shadow-sm p-6 space-y-5">
          <div className="space-y-2">
            <label className="text-sm font-medium">{t("amountLabel")}</label>
            <div className="grid grid-cols-4 gap-2">
              {SUGGESTED.map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setAmount(v)}
                  className={cn(
                    "rounded-lg border py-2.5 text-sm font-semibold transition-colors",
                    amount === v
                      ? "bg-violet-600 border-violet-600 text-white"
                      : "border-input hover:border-violet-400 hover:text-violet-700",
                  )}
                >
                  {v} €
                </button>
              ))}
            </div>
            <CurrencyInput value={amount} onChange={setAmount} />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("messageLabel")}</label>
            <textarea
              value={message}
              onChange={e => setMessage(e.target.value)}
              maxLength={500}
              rows={2}
              placeholder={t("messagePlaceholder")}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-violet-400 resize-none"
            />
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={anonymous}
              onChange={e => setAnonymous(e.target.checked)}
              className="mt-0.5 rounded border-input accent-violet-600"
            />
            <span className="text-sm text-muted-foreground">
              {t("anonymousLabel")}
            </span>
          </label>

          <Button
            type="submit"
            disabled={!canSubmit}
            loading={loading}
            className="w-full bg-violet-600 hover:bg-violet-700 text-white"
          >
            <HandshakeIcon className="size-4 mr-2" />
            {amount > 0 ? t("submitWithAmount", { amount: amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" }) }) : t("makeDonation")}
          </Button>

          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => router.push(`/portal/${slug}/dons`)}
          >
            {tCommon("cancel")}
          </Button>
        </form>
      )}
    </div>
  )
}
