"use client"

import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
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
        toast.success("Connexion réussie — ces identifiants fonctionnent.")
      } else {
        toast.error(result.error ?? "Connexion impossible.")
      }
    } catch {
      toast.error("Impossible de tester la connexion.")
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
        toast.success("Configuration LiveKit enregistrée")
      } else {
        toast.warning("Enregistré, mais il manque encore un champ — les réunions utiliseront le compte de la plateforme tant que les 3 champs ne sont pas remplis.")
      }
      setApiKey("")
      setApiSecret("")
      setInitialized(false)
      refetch()
      qc.invalidateQueries({ queryKey: ["livekit-config"] })
    } catch {
      toast.error("Impossible d'enregistrer la configuration LiveKit")
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
      toast.success("Identifiants LiveKit supprimés")
      setApiKey("")
      setApiSecret("")
      setInitialized(false)
      setRemoveConfirmOpen(false)
      refetch()
    } catch {
      toast.error("Impossible de supprimer les identifiants")
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
          <h3 className="text-sm font-semibold">Réunions vidéo (LiveKit)</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Utilisé pour les réunions vidéo. Sans compte propre, les réunions tournent sur le
          compte partagé de la plateforme — limité au plan LiveKit de la plateforme.
          Configurez votre propre projet LiveKit pour un usage illimité, facturé directement
          sur votre compte. Les enregistrements audio restent stockés sur l'infrastructure de
          la plateforme dans tous les cas — seule la visioconférence utilise votre compte.
        </p>
      </div>

      {/* Status */}
      {data?.livekitConfigured ? (
        <div className="rounded-xl border bg-emerald-50 dark:bg-emerald-950/30 p-3 flex items-start gap-2.5">
          <CheckCircleIcon className="size-4 mt-0.5 shrink-0 text-emerald-600" />
          <div className="space-y-0.5 flex-1 min-w-0">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Compte LiveKit personnalisé configuré</p>
            {data.livekitUrl && (
              <p className="text-xs text-muted-foreground">URL : <code className="font-mono">{data.livekitUrl}</code></p>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border bg-amber-50 dark:bg-amber-950/20 p-3 flex items-start gap-2.5">
          <WarningIcon className="size-4 mt-0.5 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Compte de la plateforme utilisé — usage limité au plan LiveKit de la plateforme.
          </p>
        </div>
      )}

      {canEdit && (
        <div className="space-y-4">
          <FormField
            label="URL du serveur (wss://)"
            placeholder="wss://votre-projet.livekit.cloud"
            value={url}
            onChange={e => setUrl(e.target.value)}
          />

          <FormField
            label="API Key"
            placeholder={data?.livekitConfigured ? "Clé existante — saisissez pour remplacer" : "APIxxxxxxxxxxxxxxx"}
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
          />

          <FormField
            label="API Secret"
            type="password"
            placeholder={data?.livekitConfigured ? "Secret existant — saisissez pour remplacer" : "•••••••••••••••••••••••••••••••"}
            value={apiSecret}
            onChange={e => setApiSecret(e.target.value)}
          />
          <p className="text-xs text-muted-foreground -mt-2">
            Retrouvez vos identifiants sur <span className="font-mono">cloud.livekit.io</span>
          </p>

          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={handleTest}
              disabled={!canTest || testing}
            >
              {testing
                ? <><CircleNotchIcon className="mr-1.5 size-3.5 animate-spin" />Test en cours…</>
                : <><PlugsIcon className="mr-1.5 size-3.5" />Tester la connexion</>
              }
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!canSave || saving}
            >
              {saving
                ? <><CircleNotchIcon className="mr-1.5 size-3.5 animate-spin" />Enregistrement…</>
                : <><VideoCameraIcon className="mr-1.5 size-3.5" />Enregistrer</>
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
                Supprimer les identifiants
              </Button>
            )}
          </div>

          {data?.webhookUrl && (
            <div className="rounded-xl border bg-muted/30 p-3 space-y-1">
              <p className="text-xs font-medium">Webhook à configurer sur votre projet LiveKit</p>
              <p className="text-xs text-muted-foreground">
                Dans cloud.livekit.io → Settings → Webhooks, ajoutez cette URL signée avec la
                même API Key ci-dessus, sinon une réunion oubliée ouverte ne se fermera plus
                automatiquement sur votre compte.
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
        title="Supprimer les identifiants LiveKit ?"
        description="Les réunions repasseront sur le compte partagé de la plateforme, limité à son propre plan LiveKit. Une réunion en cours sur votre compte ne sera pas automatiquement transférée."
        confirmLabel="Supprimer"
        loading={saving}
      />
    </div>
  )
}
