"use client"

import { useEffect, useState } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { PlusIcon, TrashIcon } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { CurrencyField } from "@/components/ui/currency-field"

type DonationInterval = "MONTH" | "QUARTER" | "YEAR"

type DonationTierDraft = {
  id?: string
  kind: "ONE_OFF" | "RECURRING"
  interval: DonationInterval | null
  freeAmount: boolean
  amount: number | null
  label: string
  receiptMode: "NONE" | "FULL" | "PARTIAL"
  deductibleAmount: number | null
}
type DonationTier = DonationTierDraft & { id: string; order: number }

let nextTempId = 0

export function DonationTiersEditor({ formId }: { formId: string }) {
  const t       = useTranslations("donationForms.detail.steps.tiers")
  const tCommon = useTranslations("common")
  const qc      = useQueryClient()

  const { data, isLoading } = useQuery<DonationTier[]>({
    queryKey: ["donation-form", formId, "tiers"],
    queryFn:  () => fetch(`/api/donation-forms/${formId}/tiers`).then(r => r.json()),
  })

  const saveMutation = useMutation({
    mutationFn: async (tiers: (DonationTierDraft & { order: number })[]) => {
      const res = await fetch(`/api/donation-forms/${formId}/tiers`, {
        method:  "PUT",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(tiers),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        // The route returns a Zod issues array on validation failure, not a plain string —
        // `new Error(array)` used to stringify it as "[object Object],[object Object]",
        // silently swallowing whatever specific message the server took the trouble to write.
        const message = Array.isArray(body?.error)
          ? body.error.map((issue: { message?: string }) => issue.message).filter(Boolean).join(" ")
          : body?.error
        throw new Error(message || tCommon("error"))
      }
      return res.json() as Promise<DonationTier[]>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["donation-form", formId, "tiers"] }),
  })

  const [tiers, setTiers] = useState<(DonationTierDraft & { key: string })[]>([])

  // amount/deductibleAmount come back from the API as strings — Prisma's Decimal serializes
  // to JSON as a string, not a number — so the PUT below would 422 ("expected number,
  // received string") the moment a tier is saved again without its CurrencyField ever being
  // touched (the only place that turns the value back into a real number — see onChange).
  useEffect(() => { if (data) setTiers(data.map(t => ({
    ...t, key: t.id,
    amount:           t.amount != null ? Number(t.amount) : null,
    deductibleAmount: t.deductibleAmount != null ? Number(t.deductibleAmount) : null,
  }))) }, [data])

  function addTier() {
    setTiers(prev => [...prev, { key: `new-${nextTempId++}`, kind: "ONE_OFF", interval: null, freeAmount: false, amount: null, label: "", receiptMode: "FULL", deductibleAmount: null }])
  }
  function updateTier(key: string, patch: Partial<DonationTierDraft>) {
    setTiers(prev => prev.map(t => t.key === key ? { ...t, ...patch } : t))
  }
  function removeTier(key: string) {
    setTiers(prev => prev.filter(t => t.key !== key))
  }

  async function handleSave() {
    if (tiers.some(t => !t.label.trim())) {
      toast.error(t("labelRequiredError"))
      return
    }
    if (tiers.some(t => !t.freeAmount && !t.amount)) {
      toast.error(t("amountRequiredError"))
      return
    }
    if (tiers.some(t => t.kind === "RECURRING" && !t.interval)) {
      toast.error(t("intervalRequiredError"))
      return
    }
    if (tiers.some(t => t.receiptMode === "PARTIAL" && !t.deductibleAmount)) {
      toast.error(t("deductibleAmountRequiredError"))
      return
    }
    if (tiers.some(t => t.receiptMode === "PARTIAL" && t.amount != null && t.deductibleAmount != null && t.deductibleAmount > t.amount)) {
      toast.error(t("deductibleAmountExceedsError"))
      return
    }
    try {
      await saveMutation.mutateAsync(tiers.map((t, order) => ({
        id: t.id, order, kind: t.kind, interval: t.kind === "RECURRING" ? t.interval : null,
        freeAmount: t.freeAmount, amount: t.freeAmount ? null : t.amount, label: t.label, receiptMode: t.receiptMode,
        deductibleAmount: t.receiptMode === "PARTIAL" ? t.deductibleAmount : null,
      })))
      toast.success(t("saved"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tCommon("error"))
    }
  }

  const receiptOptions = [
    { value: "NONE",    label: t("receiptNone") },
    { value: "FULL",    label: t("receiptFull") },
    { value: "PARTIAL", label: t("receiptPartial") },
  ]
  const kindOptions = [
    { value: "ONE_OFF",   label: t("kindOneOff") },
    { value: "RECURRING", label: t("kindRecurring") },
  ]
  const intervalOptions = [
    { value: "MONTH",   label: t("intervalMonth") },
    { value: "QUARTER", label: t("intervalQuarter") },
    { value: "YEAR",    label: t("intervalYear") },
  ]

  if (isLoading) return <p className="text-sm text-muted-foreground">{tCommon("loading")}</p>

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t("hint")}</p>

      {tiers.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("noTiers")}</p>
      )}

      <div className="space-y-3">
        {tiers.map(tier => (
          <div key={tier.key} className="flex items-start gap-2 rounded-md border border-input p-3">
            <div className="flex-1 space-y-2">
              <div className="max-w-sm">
                <FormField
                  label={t("labelField")}
                  placeholder={t("labelPlaceholder")}
                  value={tier.label}
                  onChange={e => updateTier(tier.key, { label: e.target.value })}
                />
              </div>
              <div className="flex items-end gap-3 flex-wrap">
                <div className="w-40">
                  <SelectField
                    label={t("kindField")}
                    options={kindOptions}
                    value={tier.kind}
                    onValueChange={v => updateTier(tier.key, { kind: v as "ONE_OFF" | "RECURRING", interval: v === "RECURRING" ? (tier.interval ?? "MONTH") : null })}
                  />
                </div>
                {tier.kind === "RECURRING" && (
                  <div className="w-36">
                    <SelectField
                      label={t("intervalField")}
                      options={intervalOptions}
                      value={tier.interval ?? "MONTH"}
                      onValueChange={v => updateTier(tier.key, { interval: v as DonationInterval })}
                    />
                  </div>
                )}
              </div>
              <div className="flex items-end gap-3 flex-wrap">
                <div className="w-40">
                  <CurrencyField
                    label={t("amountField")}
                    value={tier.amount ?? 0}
                    onChange={v => updateTier(tier.key, { amount: v })}
                    disabled={tier.freeAmount}
                  />
                </div>
                <div className="pb-2.5">
                  <CheckboxField
                    label={t("freeAmountField")}
                    checked={tier.freeAmount}
                    onChange={e => updateTier(tier.key, {
                      freeAmount: e.target.checked,
                      // Le montant déductible est une valeur fixe attachée au palier — n'a
                      // pas de sens dès que le donateur choisit lui-même le montant versé.
                      receiptMode: e.target.checked && tier.receiptMode === "PARTIAL" ? "FULL" : tier.receiptMode,
                    })}
                  />
                </div>
                <div className="w-36">
                  <SelectField
                    label={t("receiptModeField")}
                    options={tier.freeAmount ? receiptOptions.filter(o => o.value !== "PARTIAL") : receiptOptions}
                    value={tier.receiptMode}
                    onValueChange={v => updateTier(tier.key, { receiptMode: v as "NONE" | "FULL" | "PARTIAL" })}
                  />
                </div>
                {tier.receiptMode === "PARTIAL" && (
                  <div className="w-40">
                    <CurrencyField
                      label={t("deductibleAmountField")}
                      value={tier.deductibleAmount ?? 0}
                      onChange={v => updateTier(tier.key, { deductibleAmount: v })}
                    />
                  </div>
                )}
              </div>
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={() => removeTier(tier.key)} aria-label={t("removeTier")}>
              <TrashIcon className="size-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between pt-1">
        <Button type="button" variant="outline" size="sm" onClick={addTier}>
          <PlusIcon className="mr-1.5 size-4" />
          {t("addTier")}
        </Button>
        <Button type="button" size="sm" onClick={handleSave} loading={saveMutation.isPending}>
          {t("saveTiers")}
        </Button>
      </div>
    </div>
  )
}
