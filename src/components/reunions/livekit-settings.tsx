"use client"

import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { VideoCameraIcon, CheckCircleIcon, CircleNotchIcon, WarningIcon, PlugsIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"

type LiveKitConfig = {
  livekitUrl:        string | null
  livekitConfigured: boolean
  webhookUrl:        string
}

export function LiveKitSettings({ canEdit }: { canEdit: boolean }) {
  const t  = useTranslations("reunions.livekitSettings")
  const tc = useTranslations("common")
  const qc = useQueryClient()

  const { data, isLoading, refetch } = useQuery<LiveKitConfig>({
    queryKey: ["livekit-config"],
    queryFn:  async () => {
      const res = await fetch("/api/livekit/config")
      if (!res.ok) throw new Error()
      return res.json()
    },
  })

  const [initialized, setInitialized] = useState(false)
  const [url, setUrl]                 = useState("")
  const [apiKey, setApiKey]           = useState("")
  const [apiSecret, setApiSecret]     = useState("")
  const [saving, setSaving]           = useState(false)
  const [testing, setTesting]         = useState(false)
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false)

  useEffect(() => {
    if (data && !initialized) {
      setUrl(data.livekitUrl ?? "")
      setInitialized(true)
    }
  }, [data, initialized])

  const urlChanged = initialized && url !== (data?.livekitUrl ?? "")
  const isDirty    = !!apiKey || !!apiSecret || urlChanged
  const canSave     = isDirty
  // Testing needs a complete fresh triple — the server never sends the saved secret back,
  // so there's nothing to test against for fields the admin didn't just retype.
  const canTest = !!url && !!apiKey && !!apiSecret

  async function handleTest() {
    setTesting(true)
    try {
      const res = await fetch("/api/livekit/config/test", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ livekitUrl: url, livekitApiKey: apiKey, livekitApiSecret: apiSecret }),
      })
      const result = await res.json() as { ok: boolean; error?: string }
      if (result.ok) {
        toast.success(t("toasts.testSuccess"))
      } else {
        toast.error(result.error ?? t("toasts.testFailedDefault"))
      }
    } catch {
      toast.error(t("toasts.testError"))
    } finally {
      setTesting(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    try {
      const body: Record<string, string | null> = {}
      if (url !== undefined) body.livekitUrl = url || null
      if (apiKey)    body.livekitApiKey    = apiKey
      if (apiSecret) body.livekitApiSecret = apiSecret

      const res = await fetch("/api/livekit/config", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      const result = await res.json() as { livekitConfigured: boolean }
      if (result.livekitConfigured) {
        toast.success(t("toasts.saved"))
      } else {
        toast.warning(t("toasts.savedIncomplete"))
      }
      setApiKey("")
      setApiSecret("")
      setInitialized(false)
      refetch()
      qc.invalidateQueries({ queryKey: ["livekit-config"] })
    } catch {
      toast.error(t("toasts.saveError"))
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove() {
    setSaving(true)
    try {
      const res = await fetch("/api/livekit/config", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ livekitUrl: null, livekitApiKey: null, livekitApiSecret: null }),
      })
      if (!res.ok) throw new Error()
      toast.success(t("toasts.removed"))
      setApiKey("")
      setApiSecret("")
      setInitialized(false)
      setRemoveConfirmOpen(false)
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
          <VideoCameraIcon className="size-3.5 text-violet-600" />
          <h3 className="text-sm font-semibold">{t("heading")}</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("description")}
        </p>
      </div>

      {/* Status */}
      {data?.livekitConfigured ? (
        <div className="rounded-xl border bg-emerald-50 dark:bg-emerald-950/30 p-3 flex items-start gap-2.5">
          <CheckCircleIcon className="size-4 mt-0.5 shrink-0 text-emerald-600" />
          <div className="space-y-0.5 flex-1 min-w-0">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">{t("configuredTitle")}</p>
            {data.livekitUrl && (
              <p className="text-xs text-muted-foreground">{t("urlLabel")}<code className="font-mono">{data.livekitUrl}</code></p>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border bg-amber-50 dark:bg-amber-950/20 p-3 flex items-start gap-2.5">
          <WarningIcon className="size-4 mt-0.5 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-700 dark:text-amber-300">
            {t("notConfigured")}
          </p>
        </div>
      )}

      {canEdit && (
        <div className="space-y-4">
          <FormField
            label={t("serverUrlLabel")}
            placeholder="wss://votre-projet.livekit.cloud"
            value={url}
            onChange={e => setUrl(e.target.value)}
          />

          <FormField
            label={t("apiKeyLabel")}
            placeholder={data?.livekitConfigured ? t("apiKeyPlaceholderExisting") : "APIxxxxxxxxxxxxxxx"}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
          />

          <FormField
            label={t("apiSecretLabel")}
            type="password"
            placeholder={data?.livekitConfigured ? t("apiSecretPlaceholderExisting") : "•••••••••••••••••••••••••••••••"}
            value={apiSecret}
            onChange={e => setApiSecret(e.target.value)}
          />
          <p className="text-xs text-muted-foreground -mt-2">
            {t("credentialsHint")}<span className="font-mono">cloud.livekit.io</span>
          </p>

          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={handleTest}
              disabled={!canTest || testing}
            >
              {testing
                ? <><CircleNotchIcon className="mr-1.5 size-3.5 animate-spin" />{t("testing")}</>
                : <><PlugsIcon className="mr-1.5 size-3.5" />{t("testConnection")}</>
              }
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!canSave || saving}
            >
              {saving
                ? <><CircleNotchIcon className="mr-1.5 size-3.5 animate-spin" />{t("saving")}</>
                : <><VideoCameraIcon className="mr-1.5 size-3.5" />{t("save")}</>
              }
            </Button>
            {data?.livekitConfigured && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setRemoveConfirmOpen(true)}
                disabled={saving}
                className="text-xs text-muted-foreground"
              >
                {t("removeCredentials")}
              </Button>
            )}
          </div>

          {data?.webhookUrl && (
            <div className="rounded-xl border bg-muted/30 p-3 space-y-1">
              <p className="text-xs font-medium">{t("webhookTitle")}</p>
              <p className="text-xs text-muted-foreground">
                {t("webhookDescription")}
              </p>
              <code className="block text-xs font-mono bg-background rounded-lg border px-2 py-1.5 overflow-x-auto">
                {data.webhookUrl}
              </code>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={removeConfirmOpen}
        onOpenChange={setRemoveConfirmOpen}
        onConfirm={handleRemove}
        title={t("removeConfirmTitle")}
        description={t("removeConfirmDescription")}
        confirmLabel={tc("delete")}
        loading={saving}
      />
    </div>
  )
}
