"use client"

import { useEffect, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { MessageSquareTextIcon, InfoIcon, AlertTriangleIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { SmsSettings } from "@/lib/sms-settings"

interface Props {
  canEdit: boolean
}

type Toggle = {
  key:         keyof SmsSettings
  label:       string
  description: string
}

const TOGGLES: Toggle[] = [
  {
    key:         "rsvpConfirmation",
    label:       "Confirmation de participation",
    description: "SMS envoyé au membre lorsqu'il confirme sa participation à un événement.",
  },
  {
    key:         "eventReminder",
    label:       "Rappel d'événement",
    description: "SMS envoyé la veille de chaque événement aux participants confirmés.",
  },
  {
    key:         "memberWelcome",
    label:       "Bienvenue nouveau membre",
    description: "SMS envoyé lors de l'ajout d'un nouveau membre (rôle Membre uniquement).",
  },
]

export function SmsSettings({ canEdit }: Props) {
  const qc = useQueryClient()

  const { data, isLoading } = useQuery<SmsSettings>({
    queryKey: ["sms-settings"],
    queryFn:  () => fetch("/api/association/sms-settings").then(r => r.json()),
  })

  const { data: phoneCount } = useQuery<{ count: number }>({
    queryKey: ["membres-phone-count"],
    queryFn:  () => fetch("/api/membres/phone-count").then(r => r.json()),
  })

  const [settings, setSettings] = useState<SmsSettings>({
    rsvpConfirmation: false,
    eventReminder:    false,
    memberWelcome:    false,
  })
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!data) return
    setSettings(data)
    setDirty(false)
  }, [data])

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/association/sms-settings", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(settings),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? "Erreur")
      }
      return res.json()
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["sms-settings"] })
      toast.success("Paramètres SMS enregistrés")
      setDirty(false)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erreur"),
  })

  function toggle(key: keyof SmsSettings) {
    setSettings(s => ({ ...s, [key]: !s[key] }))
    setDirty(true)
  }

  const hasNoPhones = phoneCount !== undefined && phoneCount.count === 0
  const anyEnabled  = Object.values(settings).some(Boolean)

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <MessageSquareTextIcon className="size-4 mt-0.5 text-muted-foreground shrink-0" />
        <div>
          <h3 className="text-sm font-semibold">Notifications SMS</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Envoi automatique de SMS via Twilio. Seuls les membres avec un numéro renseigné reçoivent les SMS.
          </p>
        </div>
      </div>

      {/* Aviso: nenhum membro com telefone */}
      {anyEnabled && hasNoPhones && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangleIcon className="size-4 shrink-0 mt-0.5" />
          <span>Aucun membre n'a de numéro de téléphone enregistré — les SMS ne seront pas envoyés.</span>
        </div>
      )}

      {/* Info: count de membros com phone */}
      {phoneCount !== undefined && phoneCount.count > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <InfoIcon className="size-3.5 shrink-0" />
          <span>
            <strong>{phoneCount.count}</strong> membre{phoneCount.count > 1 ? "s" : ""} avec numéro enregistré.
          </span>
        </div>
      )}

      {/* Aviso: formato internacional */}
      <div className="flex items-start gap-2 rounded-lg border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
        <InfoIcon className="size-3.5 shrink-0 mt-0.5" />
        <span>
          Les numéros doivent être au format international — ex : <strong>+33 6 12 34 56 78</strong>.
          Un numéro au format local (06…) ne recevra pas le SMS.
        </span>
      </div>

      <div className="space-y-2">
        {isLoading
          ? [1, 2, 3].map(i => (
              <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />
            ))
          : TOGGLES.map(({ key, label, description }) => (
              <label
                key={key}
                className={`flex items-start gap-3 rounded-lg border p-4 transition-colors ${
                  canEdit ? "cursor-pointer hover:bg-muted/30" : "cursor-default"
                }`}
              >
                <input
                  type="checkbox"
                  checked={settings[key]}
                  disabled={!canEdit}
                  onChange={() => toggle(key)}
                  className="mt-0.5 rounded border-input accent-violet-600"
                />
                <div>
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
                </div>
              </label>
            ))}
      </div>

      {canEdit && (
        <Button
          size="sm"
          disabled={!dirty}
          loading={mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Enregistrer
        </Button>
      )}
    </div>
  )
}
