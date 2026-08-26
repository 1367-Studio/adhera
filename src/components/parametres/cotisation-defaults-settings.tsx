"use client"

import { useEffect, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { CurrencyField } from "@/components/ui/currency-field"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { Button } from "@/components/ui/button"
import { apiErrorMessage } from "@/lib/api-error"

// Same query key as stripe-connect-settings.tsx (Paramètres → Paiements) — sharing it means
// visiting either tab keeps both in sync without a duplicate fetch.
type ConnectStatus = { status: "not_connected" | "incomplete" | "pending" | "enabled" | "invalid"; chargesEnabled?: boolean }

interface CotisationDefaultsSettingsProps {
  canEdit: boolean
  cotisationDefaultAmount: string | number | null
  publicMembershipPaymentEnabled: boolean
}

// 0 doubles as "not configured" here — same convention as e.g. material-modal.tsx's
// purchasePrice: CurrencyField has no empty state, so 0 is shown for null, and 0 is sent
// back as null on save (a 0€ default wouldn't survive online payment anyway).
export function CotisationDefaultsSettings({ canEdit, cotisationDefaultAmount, publicMembershipPaymentEnabled }: CotisationDefaultsSettingsProps) {
  const t = useTranslations("parametres.cotisationDefaultsSettings")
  const tCommon = useTranslations("common")
  const qc = useQueryClient()

  const [amount, setAmount]   = useState(cotisationDefaultAmount != null ? Number(cotisationDefaultAmount) : 0)
  const [publicPayment, setPublicPayment] = useState(publicMembershipPaymentEnabled)
  const [dirty, setDirty]     = useState(false)

  // Keyed off the live toggle (publicPayment), not the saved prop — otherwise the warning
  // only appears after the admin has already saved a first time and the page refetched,
  // exactly when it's least useful. Checking as soon as they flip the checkbox lets them
  // see the problem before they save at all.
  const { data: connectStatus } = useQuery<ConnectStatus>({
    queryKey: ["connect-status"],
    queryFn:  () => fetch("/api/connect/status").then(r => r.json()),
    enabled:  publicPayment,
  })

  useEffect(() => {
    // Skip while the user has an unsaved edit in progress — e.g. another admin saved a
    // different value in the meantime and this query refetched in the background. Without
    // this guard the field (and the "dirty" flag gating the Enregistrer button) would be
    // silently reset out from under whatever they were typing.
    if (dirty) return
    setAmount(cotisationDefaultAmount != null ? Number(cotisationDefaultAmount) : 0)
    setPublicPayment(publicMembershipPaymentEnabled)
  }, [cotisationDefaultAmount, publicMembershipPaymentEnabled, dirty])

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/association/cotisation-defaults", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          cotisationDefaultAmount:        amount > 0 ? amount : null,
          publicMembershipPaymentEnabled: publicPayment,
        }),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res, tCommon("error")))
      return res.json() as Promise<{ cotisationDefaultAmount: string | null; publicMembershipPaymentEnabled: boolean }>
    },
    onSuccess: (saved) => {
      setAmount(saved.cotisationDefaultAmount != null ? Number(saved.cotisationDefaultAmount) : 0)
      setPublicPayment(saved.publicMembershipPaymentEnabled)
      qc.invalidateQueries({ queryKey: ["association"] })
      toast.success(t("toasts.updated"))
      setDirty(false)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : tCommon("error")),
  })

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-semibold">{t("title")}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          {t("subtitle")}
        </p>
      </div>

      <div className="max-w-xs">
        <CurrencyField
          label={t("defaultAmount")}
          disabled={!canEdit}
          value={amount}
          onChange={v => { setAmount(v); setDirty(true) }}
          hint={t("defaultAmountHint")}
        />
      </div>

      <CheckboxField
        id="public-membership-payment-enabled"
        label={t("publicPaymentToggle")}
        description={amount > 0 ? t("publicPaymentToggleDesc") : t("publicPaymentRequiresAmount")}
        checked={publicPayment}
        disabled={!canEdit || amount <= 0}
        onChange={e => { setPublicPayment(e.target.checked); setDirty(true) }}
      />

      {publicPayment && connectStatus && connectStatus.status !== "enabled" && (
        <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
          <WarningCircleIcon className="size-3.5 shrink-0 mt-0.5" />
          <span>{t("connectNotReadyWarning")}</span>
        </div>
      )}

      {canEdit && (
        <Button size="sm" disabled={!dirty} loading={mutation.isPending} onClick={() => mutation.mutate()}>
          {tCommon("save")}
        </Button>
      )}
    </div>
  )
}
