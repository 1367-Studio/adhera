"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { toast } from "sonner"
import { CheckCircleIcon, CreditCardIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"

type PayInfo = {
  associationName: string
  firstName:       string
  lastName:        string
  year:            number
  amountDue:       number
  paid:            boolean
  online:          boolean
}

// Public payment page behind Cotisation.paymentToken — the "réglez de votre côté" link
// emailed when an admin creates the member from the dashboard. No login: same pattern as
// the ticket-cancellation page (src/app/annulation/[token]/page.tsx).
export default function CotisationPayPage() {
  const { token } = useParams<{ token: string }>()

  const [info, setInfo]         = useState<PayInfo | null>(null)
  const [loading, setLoading]   = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // Read from location.search rather than useSearchParams, which would force a Suspense
  // boundary around this page for no other benefit. Lazy-initialized: during server
  // prerender (no window) this is null, and by the time outcome affects the rendered
  // output the page has hydrated and fetched, so both renders agree.
  const [outcome] = useState<"success" | "cancelled" | null>(() => {
    if (typeof window === "undefined") return null
    const payment = new URLSearchParams(window.location.search).get("payment")
    return payment === "success" || payment === "cancelled" ? payment : null
  })

  useEffect(() => {
    fetch(`/api/public/cotisation/${token}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then((d: PayInfo) => setInfo(d))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [token])

  async function handlePay() {
    setSubmitting(true)
    try {
      const res  = await fetch(`/api/public/cotisation/${token}`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? "Erreur"); return }
      window.location.href = data.url
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
        <p className="text-muted-foreground">Ce lien de paiement est invalide.</p>
      </div>
    )
  }

  const amountStr = info.amountDue.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background flex items-start justify-center py-12 px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center size-12 rounded-full bg-primary/10 dark:bg-primary/20 mb-2">
            <CreditCardIcon className="size-6 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Cotisation {info.year} — {info.associationName}</h1>
          <p className="text-muted-foreground text-sm">{info.firstName} {info.lastName}</p>
        </div>

        <div className="rounded-lg border bg-card p-6 space-y-4 text-center">
          {outcome === "success" ? (
            <div className="flex flex-col items-center gap-2">
              <CheckCircleIcon className="size-6 text-primary" />
              <p className="font-medium">Merci, votre paiement a bien été effectué.</p>
              <p className="text-sm text-muted-foreground">Vous recevrez la confirmation de l&apos;association — aucune autre action n&apos;est nécessaire.</p>
            </div>
          ) : info.paid ? (
            <p className="text-sm text-muted-foreground">Cette cotisation est déjà réglée. Rien à payer.</p>
          ) : !info.online ? (
            <div className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
              <WarningCircleIcon className="size-5" />
              <p>Le paiement en ligne n&apos;est pas disponible pour cette association. Contactez-la pour régler votre cotisation ({amountStr}).</p>
            </div>
          ) : (
            <>
              {outcome === "cancelled" && (
                <p className="text-sm text-muted-foreground">Paiement annulé — vous pouvez réessayer quand vous voulez.</p>
              )}
              <div>
                <span className="text-sm text-muted-foreground block">Montant à régler</span>
                <span className="text-2xl font-bold">{amountStr}</span>
              </div>
              <p className="text-sm text-muted-foreground">Paiement sécurisé par carte bancaire.</p>
              <Button loading={submitting} onClick={handlePay} className="w-full">
                Payer {amountStr}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
