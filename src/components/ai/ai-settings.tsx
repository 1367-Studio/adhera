"use client"

import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { RobotIcon, CheckCircleIcon, CircleNotchIcon, SparkleIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"

type AiConfig = {
  aiProvider:         string | null
  aiModel:            string | null
  aiApiKeyConfigured: boolean
  usingPlatformKey:   boolean
  supportedProviders: string[]
  // Sourced from src/lib/ai/client.ts's DEFAULT_MODELS via the API — never hardcoded here,
  // so this can't drift from what the server actually falls back to at call time.
  defaultModels:      Record<string, string>
}

const PROVIDER_LABELS: Record<string, string> = {
  groq:    "Groq",
  openai:  "OpenAI",
  mistral: "Mistral AI",
}

const PROVIDER_DOCS: Record<string, string> = {
  groq:    "console.groq.com/keys",
  openai:  "platform.openai.com/api-keys",
  mistral: "console.mistral.ai/api-keys",
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
  const [provider,    setProvider]    = useState("")
  const [apiKey,      setApiKey]      = useState("")
  const [model,       setModel]       = useState("")
  const [saving,      setSaving]      = useState(false)

  useEffect(() => {
    if (data && !initialized) {
      setProvider(data.aiProvider ?? "")
      setModel(data.aiModel ?? "")
      setInitialized(true)
    }
  }, [data, initialized])

  // Switching provider invalidates whatever key was stored for the old one, so a new key
  // is required at that point even though one was already configured.
  const providerChanged = initialized && provider !== (data?.aiProvider ?? "")
  const keyRequired      = !data?.aiApiKeyConfigured || providerChanged
  const isDirty           = initialized && (providerChanged || model !== (data?.aiModel ?? "") || !!apiKey)
  const canSave            = isDirty && !!provider && (!keyRequired || !!apiKey)

  async function handleSave() {
    setSaving(true)
    try {
      const body: Record<string, string | null> = {
        aiProvider: provider || null,
        aiModel:    model    || null,
      }
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
        body:    JSON.stringify({ aiProvider: null, aiApiKey: null, aiModel: null }),
      })
      if (!res.ok) throw new Error()
      toast.success("Clé supprimée — retour à la clé de la plateforme")
      setProvider("")
      setApiKey("")
      setModel("")
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
        {[1, 2, 3].map(i => <div key={i} className="h-9 rounded-lg bg-muted animate-pulse" />)}
      </div>
    )
  }

  const isConfigured = !!data?.aiProvider && data?.aiApiKeyConfigured

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
          Configurez votre propre clé (Groq, OpenAI ou Mistral) pour que les coûts soient facturés sur votre compte.
        </p>
      </div>

      {/* Status */}
      {isConfigured ? (
        <div className="rounded-xl border bg-emerald-50 dark:bg-emerald-950/30 p-3 flex items-start gap-2.5">
          <CheckCircleIcon className="size-4 mt-0.5 shrink-0 text-emerald-600" />
          <div className="space-y-0.5 flex-1 min-w-0">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Clé personnalisée configurée</p>
            <p className="text-xs text-muted-foreground">
              Fournisseur : <strong>{PROVIDER_LABELS[data.aiProvider!] ?? data.aiProvider}</strong>
              {data.aiModel && <> · Modèle : <code className="font-mono">{data.aiModel}</code></>}
            </p>
            {data.aiProvider !== "groq" && (
              <p className="text-xs text-muted-foreground">
                La transcription des réunions utilise toujours Groq (seul fournisseur compatible) — elle continue d&apos;utiliser la clé de la plateforme, pas votre clé {PROVIDER_LABELS[data.aiProvider!] ?? data.aiProvider}.
              </p>
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
          <SelectField
            label="Fournisseur"
            placeholder="Choisir un fournisseur…"
            options={(data?.supportedProviders ?? []).map(p => ({ value: p, label: PROVIDER_LABELS[p] ?? p }))}
            value={provider}
            onValueChange={v => { setProvider(v); setModel("") }}
          />

          <FormField
            label="Clé API"
            type="password"
            placeholder={
              data?.aiApiKeyConfigured && !providerChanged
                ? "Clé existante — saisissez pour remplacer"
                : "Coller votre clé API…"
            }
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            hint={provider ? `Obtenez votre clé sur ${PROVIDER_DOCS[provider]}` : undefined}
          />

          <FormField
            label="Modèle"
            placeholder={provider ? `Défaut : ${data?.defaultModels?.[provider] ?? ""}` : "Sélectionnez d'abord un fournisseur"}
            value={model}
            onChange={e => setModel(e.target.value)}
            disabled={!provider}
            hint="Laissez vide pour utiliser le modèle par défaut."
          />

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
            {isConfigured && (
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
