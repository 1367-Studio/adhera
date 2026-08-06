"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { DownloadSimpleIcon, WarningCircleIcon, ClockIcon, CircleNotchIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { APP_NAME } from "@/config/brand"
import { BASE_PATH } from "@/lib/env"
import { BrandLogo } from "@/components/layout/brand-logo"
import { isColorDark } from "@/lib/color"

type MeetingShareInfo = {
  title:       string
  scheduledAt: string | null
  startedAt:   string | null
  expired:     boolean
  association: { name: string; logoUrl: string | null; primaryColor: string | null } | null
}

type State = "loading" | "ready" | "expired" | "invalid" | "error"

export default function MeetingSharePage() {
  const t = useTranslations("portal.meetingShare")
  const { slug, token } = useParams<{ slug: string; token: string }>()
  const [state, setState] = useState<State>("loading")
  const [info, setInfo]   = useState<MeetingShareInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!cancelled) setState("loading")
      try {
        const res = await fetch(`/api/portal/meetings/share/${token}`)
        if (cancelled) return
          if (res.status === 401) {
            const path = window.location.pathname.startsWith(BASE_PATH)
              ? window.location.pathname.slice(BASE_PATH.length)
              : window.location.pathname
            const callbackUrl = encodeURIComponent(path)
            window.location.href = `${BASE_PATH}/portal/${slug}/login?callbackUrl=${callbackUrl}`
            return
          }

        if (res.status === 404) { setState("invalid"); return }
        if (!res.ok)            { setState("error");   return }
        const data = await res.json() as MeetingShareInfo
        setInfo(data)
        setState(data.expired ? "expired" : "ready")
      } catch {
        if (!cancelled) setState("error")
      }
    }
    load()
    return () => { cancelled = true }
  }, [slug, token])

  const branding = info?.association
  const brandStyle = branding?.primaryColor ? {
    "--primary":            branding.primaryColor,
    "--primary-foreground": isColorDark(branding.primaryColor) ? "#fff" : "#111827",
  } as React.CSSProperties : undefined

  const meetingDate = info?.startedAt ?? info?.scheduledAt

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

        {state === "ready" && info && (
          <>
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("label")}</p>
              <h1 className="text-2xl font-semibold">{info.title}</h1>
              {meetingDate && (
                <p className="text-sm text-muted-foreground">
                  {format(new Date(meetingDate), "EEEE dd MMMM yyyy · HH:mm", { locale: fr })}
                </p>
              )}
            </div>
            <Button size="lg" className="w-full" onClick={() => window.open(`${BASE_PATH}/api/portal/meetings/share/${token}/pdf`, "_blank")}>
              <DownloadSimpleIcon className="mr-2 size-5" />
              {t("download")}
            </Button>
          </>
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
            <p className="text-sm text-muted-foreground">{t("genericError")}</p>
          </div>
        )}

      </div>
    </div>
  )
}
