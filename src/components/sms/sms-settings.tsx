"use client"

import { useEffect, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { ChatTextIcon, CheckCircleIcon, CircleNotchIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"

type SmsConfig = {
  smsPhoneNumber: string | null
  smsConfigured:  boolean
}

export function SmsSettings({ canEdit }: { canEdit: boolean }) {
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
        toast.success("Configuration SMS enregistrée")
      } else {
        toast.warning("Enregistré, mais il manque encore un champ — les SMS ne fonctionneront pas tant que les 3 champs ne sont pas remplis.")
      }
      setAccountSid("")
      setAuthToken("")
      setInitialized(false)
      refetch()
      qc.invalidateQueries({ queryKey: ["sms-config"] })
    } catch {
      toast.error("Impossible d'enregistrer la configuration SMS")
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
      toast.success("Identifiants Twilio supprimés")
      setAccountSid("")
      setAuthToken("")
      setInitialized(false)
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
          <ChatTextIcon className="size-3.5 text-sky-600" />
          <h3 className="text-sm font-semibold">Notifications SMS</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Utilisé pour l'envoi de SMS aux membres. Nécessite votre propre compte Twilio —
          il n'y a pas de clé partagée par la plateforme, les SMS sont facturés directement sur votre compte Twilio.
        </p>
      </div>

      {/* Status */}
      {data?.smsConfigured ? (
        <div className="rounded-xl border bg-emerald-50 dark:bg-emerald-950/30 p-3 flex items-start gap-2.5">
          <CheckCircleIcon className="size-4 mt-0.5 shrink-0 text-emerald-600" />
          <div className="space-y-0.5 flex-1 min-w-0">
            <p className="text-sm font-medium text-emerald-700 dark:text-emerald-400">Compte Twilio configuré</p>
            {data.smsPhoneNumber && (
              <p className="text-xs text-muted-foreground">Numéro : <code className="font-mono">{data.smsPhoneNumber}</code></p>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border bg-amber-50 dark:bg-amber-950/20 p-3 flex items-start gap-2.5">
          <WarningIcon className="size-4 mt-0.5 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Aucun compte Twilio configuré — l'envoi de SMS ne fonctionnera pas tant que vous n'aurez pas renseigné vos identifiants.
          </p>
        </div>
      )}

      {canEdit && (
        <div className="space-y-4">
          <FormField
            label="Account SID"
            placeholder={data?.smsConfigured ? "SID existant — saisissez pour remplacer" : "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}
            value={accountSid}
            onChange={e => setAccountSid(e.target.value)}
          />

          <FormField
            label="Auth Token"
            type="password"
            placeholder={data?.smsConfigured ? "Token existant — saisissez pour remplacer" : "•••••••••••••••••••••••••••••••"}
            value={authToken}
            onChange={e => setAuthToken(e.target.value)}
          />
          <p className="text-xs text-muted-foreground -mt-2">
            Retrouvez vos identifiants sur <span className="font-mono">console.twilio.com</span>
          </p>

          <FormField
            label="Numéro d'envoi"
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
                ? <><CircleNotchIcon className="mr-1.5 size-3.5 animate-spin" />Enregistrement…</>
                : <><ChatTextIcon className="mr-1.5 size-3.5" />Enregistrer</>
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
                Supprimer les identifiants
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
