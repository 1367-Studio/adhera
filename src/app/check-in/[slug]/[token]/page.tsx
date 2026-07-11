"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { CheckCircleIcon, WarningCircleIcon, ClockIcon, CircleNotchIcon, AsteriskIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { APP_NAME } from "@/config/brand"

type EventInfo = {
  title:            string
  date:             string
  expired:          boolean
  alreadyCheckedIn: boolean
  totalPresent:     number
}

type State = "loading" | "ready" | "checking-in" | "success" | "already" | "expired" | "invalid" | "error"

export default function CheckInPage() {
  const { slug, token } = useParams<{ slug: string; token: string }>()
  const [state, setState]      = useState<State>("loading")
  const [info, setInfo]        = useState<EventInfo | null>(null)
  const [errMsg, setErrMsg]    = useState("")
  const [retryCount, setRetry] = useState(0)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!cancelled) setState("loading")
      try {
        const res = await fetch(`/api/portal/check-in/${token}`)
        if (cancelled) return
        if (res.status === 401) {
          const callbackUrl = encodeURIComponent(window.location.pathname)
          window.location.href = `/portal/${slug}/login?callbackUrl=${callbackUrl}`
          return
        }
        if (res.status === 404) { setState("invalid"); return }
        if (!res.ok)            { setState("error");   return }
        const data = await res.json() as EventInfo
        setInfo(data)
        if (data.expired)              setState("expired")
        else if (data.alreadyCheckedIn) setState("already")
        else                           setState("ready")
      } catch {
        if (!cancelled) setState("error")
      }
    }
    load()
    return () => { cancelled = true }
  }, [slug, token, retryCount])

  async function handleCheckIn() {
    setState("checking-in")
    try {
      const res  = await fetch(`/api/portal/check-in/${token}`, { method: "POST" })
      const data = await res.json()
      if (!res.ok) { setErrMsg(data.error ?? "Erreur"); setState("error"); return }
      setState(data.alreadyCheckedIn ? "already" : "success")
    } catch {
      setErrMsg("Erreur réseau")
      setState("error")
    }
  }

  function handleRetry() {
    setErrMsg("")
    setRetry(c => c + 1)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-sm space-y-6 text-center">

        <div className="flex items-center justify-center gap-2 mb-8">
          <AsteriskIcon className="size-6" weight="bold" />
          <span className="text-base font-semibold">{APP_NAME}</span>
        </div>

        {state === "loading" && (
          <CircleNotchIcon className="size-12 mx-auto text-muted-foreground animate-spin" />
        )}

        {(state === "ready" || state === "checking-in") && info && (
          <>
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Check-in</p>
              <h1 className="text-2xl font-semibold">{info.title}</h1>
              <p className="text-sm text-muted-foreground">
                {format(new Date(info.date), "EEEE dd MMMM yyyy · HH:mm", { locale: fr })}
              </p>
            </div>
            <Button size="lg" className="w-full" onClick={handleCheckIn} loading={state === "checking-in"}>
              <CheckCircleIcon className="mr-2 size-5" />
              Confirmer ma présence
            </Button>
            <p className="text-xs text-muted-foreground">
              {info.totalPresent} personne{info.totalPresent !== 1 ? "s" : ""} déjà enregistrée{info.totalPresent !== 1 ? "s" : ""}
            </p>
          </>
        )}

        {state === "success" && (
          <div className="space-y-3">
            <CheckCircleIcon className="size-16 mx-auto text-green-500" />
            <h2 className="text-xl font-semibold text-green-700 dark:text-green-400">Présence enregistrée !</h2>
            <p className="text-sm text-muted-foreground">
              Votre présence pour <strong>{info?.title}</strong> a été confirmée.
            </p>
          </div>
        )}

        {state === "already" && (
          <div className="space-y-3">
            <CheckCircleIcon className="size-16 mx-auto text-blue-500" />
            <h2 className="text-xl font-semibold">Déjà enregistré</h2>
            <p className="text-sm text-muted-foreground">
              Votre présence pour <strong>{info?.title}</strong> a déjà été confirmée.
            </p>
          </div>
        )}

        {state === "expired" && (
          <div className="space-y-3">
            <ClockIcon className="size-16 mx-auto text-amber-500" />
            <h2 className="text-xl font-semibold text-amber-700 dark:text-amber-400">QR Code expiré</h2>
            <p className="text-sm text-muted-foreground">Ce QR Code n&apos;est plus valide. Contactez l&apos;organisateur.</p>
          </div>
        )}

        {state === "invalid" && (
          <div className="space-y-3">
            <WarningCircleIcon className="size-16 mx-auto text-destructive" />
            <h2 className="text-xl font-semibold">QR Code invalide</h2>
            <p className="text-sm text-muted-foreground">Ce lien ne correspond à aucun événement.</p>
          </div>
        )}

        {state === "error" && (
          <div className="space-y-3">
            <WarningCircleIcon className="size-16 mx-auto text-destructive" />
            <h2 className="text-xl font-semibold">Erreur</h2>
            <p className="text-sm text-muted-foreground">{errMsg || "Une erreur est survenue."}</p>
            <Button variant="outline" onClick={handleRetry}>Réessayer</Button>
          </div>
        )}

      </div>
    </div>
  )
}
