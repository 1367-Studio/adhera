"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { XCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"

type CancelInfo = {
  associationName: string
  formTitle:       string
  firstName:       string
  lastName:        string
  amount:          string
  interval:        "MONTH" | "QUARTER" | "YEAR"
  cancelled:       boolean
}

export default function CancelDonationSubscriptionPage() {
  const { token } = useParams<{ token: string }>()
  const t = useTranslations("donationForms.cancelSubscription")

  const [info, setInfo]       = useState<CancelInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [done, setDone]       = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetch(`/api/public/donation-subscriptions/${token}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then((d: CancelInfo) => setInfo(d))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [token])

  async function handleConfirm() {
    setSubmitting(true)
    try {
      const res = await fetch(`/api/public/donation-subscriptions/${token}`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? t("genericError")); return }
      setDone(true)
    } catch {
      toast.error(t("genericError"))
    } finally {
      setSubmitting(false)
    }
  }

  const intervalLabel = (interval: CancelInfo["interval"]) =>
    interval === "MONTH" ? t("intervalMonth") : interval === "QUARTER" ? t("intervalQuarter") : t("intervalYear")

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="size-6 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
    )
  }

  if (notFound || !info) {
    return (
      <div className="min-h-screen flex items-center justify-center text-center px-4">
        <p className="text-muted-foreground">{t("invalidLink")}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background flex items-start justify-center py-12 px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center size-12 rounded-full bg-primary/10 dark:bg-primary/20 mb-2">
            <XCircleIcon className="size-6 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{info.formTitle}</h1>
          <p className="text-muted-foreground text-sm">{info.associationName}</p>
        </div>

        <div className="rounded-lg border bg-card p-6 space-y-4 text-center">
          {done ? (
            <p className="font-medium">{t("cancelledTitle")}</p>
          ) : info.cancelled ? (
            <p className="text-sm text-muted-foreground">{t("alreadyCancelled")}</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {info.firstName} {info.lastName} — {Number(info.amount).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })} / {intervalLabel(info.interval)}
              </p>
              <p className="text-sm">{t("confirmPrompt")}</p>
              <Button
                variant="destructive"
                loading={submitting}
                onClick={handleConfirm}
                className="w-full"
              >
                {t("confirmButton")}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
