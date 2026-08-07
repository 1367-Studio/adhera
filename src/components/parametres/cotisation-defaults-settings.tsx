"use client"

import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { CurrencyField } from "@/components/ui/currency-field"
import { Button } from "@/components/ui/button"
import { apiErrorMessage } from "@/lib/api-error"

interface CotisationDefaultsSettingsProps {
  canEdit: boolean
  cotisationDefaultAmount: string | number | null
}

// 0 doubles as "not configured" here — same convention as e.g. material-modal.tsx's
// purchasePrice: CurrencyField has no empty state, so 0 is shown for null, and 0 is sent
// back as null on save (a 0€ default wouldn't survive online payment anyway).
export function CotisationDefaultsSettings({ canEdit, cotisationDefaultAmount }: CotisationDefaultsSettingsProps) {
  const t = useTranslations("parametres.cotisationDefaultsSettings")
  const tCommon = useTranslations("common")
  const qc = useQueryClient()

  const [amount, setAmount] = useState(cotisationDefaultAmount != null ? Number(cotisationDefaultAmount) : 0)
  const [dirty, setDirty]   = useState(false)

  useEffect(() => {
    // Skip while the user has an unsaved edit in progress — e.g. another admin saved a
    // different value in the meantime and this query refetched in the background. Without
    // this guard the field (and the "dirty" flag gating the Enregistrer button) would be
    // silently reset out from under whatever they were typing.
    if (dirty) return
    setAmount(cotisationDefaultAmount != null ? Number(cotisationDefaultAmount) : 0)
  }, [cotisationDefaultAmount, dirty])

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/association/cotisation-defaults", {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ cotisationDefaultAmount: amount > 0 ? amount : null }),
      })
      if (!res.ok) throw new Error(await apiErrorMessage(res, tCommon("error")))
      return res.json() as Promise<{ cotisationDefaultAmount: string | null }>
    },
    onSuccess: (saved) => {
      setAmount(saved.cotisationDefaultAmount != null ? Number(saved.cotisationDefaultAmount) : 0)
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

      {canEdit && (
        <Button size="sm" disabled={!dirty} loading={mutation.isPending} onClick={() => mutation.mutate()}>
          {tCommon("save")}
        </Button>
      )}
    </div>
  )
}
