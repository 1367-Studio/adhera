"use client"

import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { RobotIcon, CheckCircleIcon, CircleNotchIcon, SparkleIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"

type AiConfig = {
  aiModel:            string | null
  aiApiKeyConfigured: boolean
  usingPlatformKey:   boolean
}

export function AiSettings({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient()

  const { data, isLoading, refetch } = useQuery<AiConfig>({
    queryKey: ["ai-config"],
    queryFn:  async () => {
      const res = await fetch("/api/ai/config")
      if (!res.ok) throw new Error()
      return res.json()
    },
  })

  const [initialized, setInitialized] = useState(false)
  const [apiKey, setApiKey]           = useState("")
  const [model, setModel]             = useState("")
  const [saving, setSaving]           = useState(false)

  useEffect(() => {
    if (data && !initialized) {
      setModel(data.aiModel ?? "")
      setInitialized(true)
    }
  }, [data, initialized])

  const modelChanged = initialized && model !== (data?.aiModel ?? "")
  const isDirty      = !!apiKey || modelChanged
  const canSave      = isDirty

  async function handleSave() {
    setSaving(true)
    try {
      const body: Record<string, string | null> = {}
      if (model !== undefined) body.aiModel = model || null
      if (apiKey) body.aiApiKey = apiKey

      const res = await fetch("/api/ai/config", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      })
      if (!res.ok) throw new Error()
      toast.success("Configuration IA enregistrée")
      setApiKey("")
      setInitialized(false)
      refetch()
      qc.invalidateQueries({ queryKey: ["ai-config"] })
    } catch {
      toast.error("Impossible d'enregistrer la configuration IA")
    } finally {
      setSaving(false)
    }
  }

  async function handleRemoveKey() {
    setSaving(true)
    try {
      const res = await fetch("/api/ai/config", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ aiApiKey: null }),
      })
      if (!res.ok) throw new Error()
      toast.success("Clé supprimée — retour à la clé de la plateforme")
      setApiKey("")
      setInitialized(false)
      refetch()
    } catch {
      toast.error("Impossible de supprimer la clé")
    } finally {
      setSaving(false)
    }
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2].map(i => <div key={i} className="h-9 rounded-lg bg-muted animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-0.5">
          <SparkleIcon className="size-3.5 text-violet-600" />
          <h3 className="text-sm font-semibold">Assistant IA</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Utilisé pour la rédaction assistée dans les éditeurs de texte.
          Par défaut, la clé de la plateforme est utilisée gratuitement.
          Configurez votre propre clé Groq pour que les coûts soient facturés sur votre compte.
        </p>
      </div>

      {/* Status */}
      {data?.aiApiKeyConfigured ? (
        <div className="rounded-xl border bg-emerald-50 dark:bg-emerald-950/30 p-3 flex items-start gap-2.5">
          <CheckCircleIcon className="size-4 mt-0.5 shrink-0 text-emerald-600" />
          <div className="space-y-0.5 flex-1 min-w-0">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Clé personnalisée configurée</p>
            {data.aiModel && (
              <p className="text-xs text-muted-foreground">Modèle : <code className="font-mono">{data.aiModel}</code></p>
            )}
          </div>
        </div>
      ) : data?.usingPlatformKey ? (
        <div className="rounded-xl border bg-violet-50 dark:bg-violet-950/20 p-3 flex items-start gap-2.5">
          <SparkleIcon className="size-4 mt-0.5 shrink-0 text-violet-600" />
          <p className="text-sm text-violet-700 dark:text-violet-300">
            Clé de la plateforme active — vous pouvez utiliser l'IA sans configuration.
          </p>
        </div>
      ) : null}

      {canEdit && (
        <div className="space-y-4">
          <FormField
            label="Clé API Groq"
            type="password"
            placeholder={
              data?.aiApiKeyConfigured
                ? "Clé existante — saisissez pour remplacer"
                : "gsk_…"
            }
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
          />
          <p className="text-xs text-muted-foreground -mt-2">
            Obtenez votre clé sur <span className="font-mono">console.groq.com/keys</span>
          </p>

          <FormField
            label="Modèle"
            placeholder="llama-3.3-70b-versatile"
            value={model}
            onChange={e => setModel(e.target.value)}
          />
          <p className="text-xs text-muted-foreground -mt-2">
            Laissez vide pour utiliser le modèle par défaut.
          </p>

          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!canSave || saving}
            >
              {saving
                ? <><CircleNotchIcon className="mr-1.5 size-3.5 animate-spin" />Enregistrement…</>
                : <><RobotIcon className="mr-1.5 size-3.5" />Enregistrer</>
              }
            </Button>
            {data?.aiApiKeyConfigured && (
              <Button
                size="sm"
                variant="ghost"
                onClick={handleRemoveKey}
                disabled={saving}
                className="text-xs text-muted-foreground"
              >
                Supprimer la clé personnalisée
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
