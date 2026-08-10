"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { toast } from "sonner"
import { XCircleIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"

type CancelInfo = {
  eventTitle: string
  eventDate:  string
  firstName:  string
  lastName:   string
  isPaid:     boolean
  amount:     string | null
  cancelled:  boolean
  past:       boolean
}

export default function CancelTicketPage() {
  const { token } = useParams<{ token: string }>()

  const [info, setInfo]       = useState<CancelInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [done, setDone]       = useState<{ refunded: boolean } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetch(`/api/public/cancel-ticket/${token}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then((d: CancelInfo) => setInfo(d))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [token])

  async function handleConfirm() {
    setSubmitting(true)
    try {
      const res = await fetch(`/api/public/cancel-ticket/${token}`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? "Erreur"); return }
      setDone({ refunded: !!data.refunded })
    } catch {
      toast.error("Erreur réseau")
    } finally {
      setSubmitting(false)
    }
  }

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
        <p className="text-muted-foreground">Ce lien d&apos;annulation est invalide.</p>
      </div>
    )
  }

  const dateStr = new Date(info.eventDate).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background flex items-start justify-center py-12 px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center size-12 rounded-full bg-primary/10 dark:bg-primary/20 mb-2">
            <XCircleIcon className="size-6 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{info.eventTitle}</h1>
          <p className="text-muted-foreground text-sm">{info.firstName} {info.lastName}</p>
        </div>

        <div className="rounded-lg border bg-card p-6 space-y-4 text-center">
          {done ? (
            <div className="space-y-1">
              <p className="font-medium">Inscription annulée.</p>
              {done.refunded && <p className="text-sm text-muted-foreground">Votre paiement a été remboursé — comptez quelques jours pour qu&apos;il apparaisse sur votre compte.</p>}
            </div>
          ) : info.cancelled ? (
            <p className="text-sm text-muted-foreground">Cette inscription est déjà annulée.</p>
          ) : info.past ? (
            <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <WarningCircleIcon className="size-5" />
              <p>Cet événement est déjà passé — l&apos;annulation n&apos;est plus possible ici. Contactez l&apos;association si besoin.</p>
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {dateStr}{info.isPaid && info.amount ? ` — ${Number(info.amount).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })}` : ""}
              </p>
              <p className="text-sm">
                {info.isPaid
                  ? "Annuler votre inscription déclenche un remboursement automatique de votre paiement."
                  : "Confirmez que vous souhaitez annuler votre inscription à cet événement."}
              </p>
              <Button
                variant="destructive"
                loading={submitting}
                onClick={handleConfirm}
                className="w-full"
              >
                {info.isPaid ? "Annuler et être remboursé" : "Annuler mon inscription"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
