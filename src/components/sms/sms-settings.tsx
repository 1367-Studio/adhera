"use client"

import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { ChatTextIcon, CheckCircleIcon, CircleNotchIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"

type SmsConfig = {
  smsPhoneNumber: string | null
  smsConfigured:  boolean
}

export function SmsSettings({ canEdit }: { canEdit: boolean }) {
  const t  = useTranslations("sms")
  const tc = useTranslations("common")
  const qc = useQueryClient()

  const { data, isLoading, refetch } = useQuery<SmsConfig>({
    queryKey: ["sms-config"],
    queryFn:  async () => {
      const res = await fetch("/api/sms/config")
      if (!res.ok) throw new Error()
      return res.json()
    },
  })

  const [initialized, setInitialized] = useState(false)
  const [accountSid, setAccountSid]   = useState("")
  const [authToken, setAuthToken]     = useState("")
  const [phoneNumber, setPhoneNumber] = useState("")
  const [saving, setSaving]           = useState(false)

  useEffect(() => {
    if (data && !initialized) {
      setPhoneNumber(data.smsPhoneNumber ?? "")
      setInitialized(true)
    }
  }, [data, initialized])

  const phoneChanged = initialized && phoneNumber !== (data?.smsPhoneNumber ?? "")
  const isDirty       = !!accountSid || !!authToken || phoneChanged
  const canSave        = isDirty

  async function handleSave() {
    setSaving(true)
    try {
      const body: Record<string, string | null> = {}
      if (accountSid) body.smsAccountSid = accountSid
      if (authToken)  body.smsAuthToken  = authToken
      if (phoneNumber !== undefined) body.smsPhoneNumber = phoneNumber || null

      const res = await fetch("/api/sms/config", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      const result = await res.json() as { smsConfigured: boolean }
      if (result.smsConfigured) {
        toast.success(t("toasts.saved"))
      } else {
        toast.warning(t("toasts.incomplete"))
      }
      setAccountSid("")
      setAuthToken("")
      setInitialized(false)
      refetch()
      qc.invalidateQueries({ queryKey: ["sms-config"] })
    } catch {
      toast.error(t("toasts.saveError"))
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    setSaving(true)
    try {
      const res = await fetch("/api/sms/config", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ smsAccountSid: null, smsAuthToken: null, smsPhoneNumber: null }),
      })
      if (!res.ok) throw new Error()
      toast.success(t("toasts.credentialsRemoved"))
      setAccountSid("")
      setAuthToken("")
      setInitialized(false)
      refetch()
    } catch {
      toast.error(t("toasts.removeError"))
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <div key={i} className="h-9 rounded-lg bg-muted animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <ChatTextIcon className="size-3.5 text-sky-600" />
          <h3 className="text-sm font-semibold">{t("heading")}</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("description")}
        </p>
      </div>

      {/* Status */}
      {data?.smsConfigured ? (
        <div className="rounded-lg border bg-emerald-50 dark:bg-emerald-950/30 p-3 flex items-start gap-2.5">
          <CheckCircleIcon className="size-4 mt-0.5 shrink-0 text-emerald-600" />
          <div className="space-y-0.5 flex-1 min-w-0">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{t("configuredTitle")}</p>
            {data.smsPhoneNumber && (
              <p className="text-xs text-muted-foreground">{t("phoneNumberLine", { number: data.smsPhoneNumber })}</p>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border bg-amber-50 dark:bg-amber-950/20 p-3 flex items-start gap-2.5">
          <WarningIcon className="size-4 mt-0.5 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-700 dark:text-amber-300">
            {t("notConfiguredWarning")}
          </p>
        </div>
      )}

      {canEdit && (
        <div className="space-y-4">
          <FormField
            label={t("accountSidLabel")}
            placeholder={data?.smsConfigured ? t("accountSidPlaceholderReplace") : "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}
            value={accountSid}
            onChange={e => setAccountSid(e.target.value)}
          />

          <FormField
            label={t("authTokenLabel")}
            type="password"
            placeholder={data?.smsConfigured ? t("authTokenPlaceholderReplace") : "•••••••••••••••••••••••••••••••"}
            value={authToken}
            onChange={e => setAuthToken(e.target.value)}
          />
          <p className="text-xs text-muted-foreground -mt-2">
            {t("credentialsHint")} <span className="font-mono">console.twilio.com</span>
          </p>

          <FormField
            label={t("phoneNumberLabel")}
            placeholder="+33612345678"
            value={phoneNumber}
            onChange={e => setPhoneNumber(e.target.value)}
          />

          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!canSave || saving}
            >
              {saving
                ? <><CircleNotchIcon className="mr-1.5 size-3.5 animate-spin" />{t("saving")}</>
                : <><ChatTextIcon className="mr-1.5 size-3.5" />{tc("save")}</>
              }
            </Button>
            {data?.smsConfigured && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleRemove}
                disabled={saving}
                className="text-xs text-muted-foreground"
              >
                {t("removeCredentials")}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
