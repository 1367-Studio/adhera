"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { CheckCircleIcon, WarningCircleIcon, ClockIcon, CircleNotchIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { APP_NAME } from "@/config/brand"
import { BASE_PATH } from "@/lib/env"
import { BrandLogo } from "@/components/layout/brand-logo"
import { isColorDark } from "@/lib/color"

type EventInfo = {
  title:            string
  date:             string
  expired:          boolean
  alreadyCheckedIn: boolean
  totalPresent:     number
  association: { name: string; logoUrl: string | null; primaryColor: string | null } | null
}

type State = "loading" | "ready" | "checking-in" | "success" | "already" | "expired" | "invalid" | "error"

export default function CheckInPage() {
  const t = useTranslations("portal.checkin")
  const tCommon = useTranslations("common")
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
          window.location.href = `${BASE_PATH}/portal/${slug}/login?callbackUrl=${callbackUrl}`
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
      if (!res.ok) { setErrMsg(data.error ?? tCommon("error")); setState("error"); return }
      setState(data.alreadyCheckedIn ? "already" : "success")
    } catch {
      setErrMsg(t("genericError"))
      setState("error")
    }
  }

  function handleRetry() {
    setErrMsg("")
    setRetry(c => c + 1)
  }

  const branding = info?.association
  const brandStyle = branding?.primaryColor ? {
    "--primary":            branding.primaryColor,
    "--primary-foreground": isColorDark(branding.primaryColor) ? "#fff" : "#111827",
  } as React.CSSProperties : undefined

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background" style={brandStyle}>
      <div className="w-full max-w-sm space-y-6 text-center">

        <div className="flex items-center justify-center gap-2 mb-8 min-w-0">
          <BrandLogo
            logoUrl={branding?.logoUrl}
            imgClassName="size-6 rounded object-contain shrink-0"
            fallbackClassName="size-6 shrink-0"
          />
          <span className="text-base font-semibold truncate">{branding?.name ?? APP_NAME}</span>
        </div>

        {state === "loading" && (
          <CircleNotchIcon className="size-12 mx-auto text-muted-foreground animate-spin" />
        )}

        {(state === "ready" || state === "checking-in") && info && (
          <>
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("label")}</p>
              <h1 className="text-2xl font-semibold">{info.title}</h1>
              <p className="text-sm text-muted-foreground">
                {format(new Date(info.date), "EEEE dd MMMM yyyy · HH:mm", { locale: fr })}
              </p>
            </div>
            <Button size="lg" className="w-full" onClick={handleCheckIn} loading={state === "checking-in"}>
              <CheckCircleIcon className="mr-2 size-5" />
              {t("confirmPresence")}
            </Button>
            <p className="text-xs text-muted-foreground">
              {t("peopleCheckedIn", { count: info.totalPresent })}
            </p>
          </>
        )}

        {state === "success" && (
          <div className="space-y-3">
            <CheckCircleIcon className="size-16 mx-auto text-green-500" />
            <h2 className="text-xl font-semibold text-green-700 dark:text-green-400">{t("successTitle")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("successDescription", { title: info?.title ?? "" })}
            </p>
          </div>
        )}

        {state === "already" && (
          <div className="space-y-3">
            <CheckCircleIcon className="size-16 mx-auto text-blue-500" />
            <h2 className="text-xl font-semibold">{t("alreadyTitle")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("alreadyDescription", { title: info?.title ?? "" })}
            </p>
          </div>
        )}

        {state === "expired" && (
          <div className="space-y-3">
            <ClockIcon className="size-16 mx-auto text-amber-500" />
            <h2 className="text-xl font-semibold text-amber-700 dark:text-amber-400">{t("expiredTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("expiredDescription")}</p>
          </div>
        )}

        {state === "invalid" && (
          <div className="space-y-3">
            <WarningCircleIcon className="size-16 mx-auto text-destructive" />
            <h2 className="text-xl font-semibold">{t("invalidTitle")}</h2>
            <p className="text-sm text-muted-foreground">{t("invalidDescription")}</p>
          </div>
        )}

        {state === "error" && (
          <div className="space-y-3">
            <WarningCircleIcon className="size-16 mx-auto text-destructive" />
            <h2 className="text-xl font-semibold">{t("errorTitle")}</h2>
            <p className="text-sm text-muted-foreground">{errMsg || t("genericError")}</p>
            <Button variant="outline" onClick={handleRetry}>{t("retry")}</Button>
          </div>
        )}

      </div>
    </div>
  )
}
