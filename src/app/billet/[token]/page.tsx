"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { QRCodeSVG } from "qrcode.react"
import { TicketIcon, CheckCircleIcon, WarningCircleIcon, XCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { BASE_PATH } from "@/lib/env"

type TicketInfo = {
  eventTitle:      string
  eventDate:       string
  eventLocation:   string | null
  associationName: string
  firstName:       string
  lastName:        string
  ticketTypeLabel: string | null
  status:          "VALID" | "PENDING" | "CANCELLED"
  present:         boolean
}

// French-only, like the other public token pages (/annulation) — it's reached from the
// confirmation email, which is French-only too.
export default function BilletPage() {
  const { token } = useParams<{ token: string }>()

  const [info, setInfo]         = useState<TicketInfo | null>(null)
  const [loading, setLoading]   = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    fetch(`/api/public/billet/${token}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json() })
      .then((d: TicketInfo) => setInfo(d))
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false))
  }, [token])

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
        <p className="text-muted-foreground">Ce billet est introuvable.</p>
      </div>
    )
  }

  const dateObj = new Date(info.eventDate)
  const dateStr = dateObj.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
  const timeStr = dateObj.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
  // Same URL the emailed QR encodes — scanning either lands here / validates the same token.
  const qrValue = `${window.location.origin}${BASE_PATH}/billet/${token}`

  const statusBanner = info.status === "CANCELLED" ? (
    <div className="flex items-center justify-center gap-2 text-sm text-red-600 dark:text-red-400">
      <XCircleIcon className="size-4 shrink-0" />
      <span>Ce billet a été annulé.</span>
    </div>
  ) : info.status === "PENDING" ? (
    <div className="flex items-center justify-center gap-2 text-sm text-amber-600 dark:text-amber-400">
      <WarningCircleIcon className="size-4 shrink-0" />
      <span>Paiement en attente — ce billet n&apos;est pas encore valide.</span>
    </div>
  ) : info.present ? (
    <div className="flex items-center justify-center gap-2 text-sm text-green-600 dark:text-green-400">
      <CheckCircleIcon className="size-4 shrink-0" />
      <span>Présence enregistrée — ce billet a déjà été scanné.</span>
    </div>
  ) : (
    <p className="text-sm text-muted-foreground">Présentez ce QR code à l&apos;entrée de l&apos;événement.</p>
  )

  return (
    <div className="min-h-screen bg-gradient-to-b from-primary/5 to-background flex items-start justify-center py-12 px-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center size-12 rounded-full bg-primary/10 dark:bg-primary/20 mb-2">
            <TicketIcon className="size-6 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{info.eventTitle}</h1>
          <p className="text-muted-foreground text-sm">{info.associationName}</p>
        </div>

        <div className="rounded-lg border bg-card p-6 space-y-4 text-center">
          {info.status === "VALID" && (
            <div className="flex justify-center">
              <div className="p-3 rounded-lg border bg-white">
                <QRCodeSVG value={qrValue} size={200} />
              </div>
            </div>
          )}

          <div className="space-y-1 text-sm">
            <p className="font-medium">
              {info.firstName} {info.lastName}
              {info.ticketTypeLabel && <span className="text-muted-foreground font-normal"> — {info.ticketTypeLabel}</span>}
            </p>
            <p className="text-muted-foreground">{dateStr} à {timeStr}</p>
            {info.eventLocation && <p className="text-muted-foreground">{info.eventLocation}</p>}
          </div>

          {statusBanner}
        </div>
      </div>
    </div>
  )
}
