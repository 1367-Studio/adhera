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
  ineligibleAmount: number | null
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

  // amount/ineligibleAmount come back from the API as strings — Prisma's Decimal serializes
  // to JSON as a string, not a number — so the PUT below would 422 ("expected number,
  // received string") the moment a tier is saved again without its CurrencyField ever being
  // touched (the only place that turns the value back into a real number — see onChange).
  useEffect(() => { if (data) setTiers(data.map(t => ({
    ...t, key: t.id,
    amount:           t.amount != null ? Number(t.amount) : null,
    ineligibleAmount: t.ineligibleAmount != null ? Number(t.ineligibleAmount) : null,
  }))) }, [data])

  function addTier() {
    setTiers(prev => [...prev, { key: `new-${nextTempId++}`, kind: "ONE_OFF", interval: null, freeAmount: false, amount: null, label: "", receiptMode: "FULL", ineligibleAmount: null }])
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
    if (tiers.some(t => t.receiptMode === "PARTIAL" && !t.ineligibleAmount)) {
      toast.error(t("ineligibleAmountRequiredError"))
      return
    }
    if (tiers.some(t => t.receiptMode === "PARTIAL" && t.amount != null && t.ineligibleAmount != null && t.ineligibleAmount > t.amount)) {
      toast.error(t("ineligibleAmountExceedsError"))
      return
    }
    try {
      await saveMutation.mutateAsync(tiers.map((t, order) => ({
        id: t.id, order, kind: t.kind, interval: t.kind === "RECURRING" ? t.interval : null,
        // amount sert de montant fixe normalement, ou de montant minimum optionnel quand
        // freeAmount est actif — jamais forcé à null.
        freeAmount: t.freeAmount, amount: t.amount, label: t.label, receiptMode: t.receiptMode,
        ineligibleAmount: t.receiptMode === "PARTIAL" ? t.ineligibleAmount : null,
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
                    label={tier.freeAmount ? t("minAmountField") : t("amountField")}
                    value={tier.amount ?? 0}
                    onChange={v => updateTier(tier.key, { amount: v })}
                  />
                </div>
                <div className="pb-2.5">
                  <CheckboxField
                    label={t("freeAmountField")}
                    checked={tier.freeAmount}
                    onChange={e => updateTier(tier.key, { freeAmount: e.target.checked })}
                  />
                </div>
                <div className="w-36">
                  <SelectField
                    label={t("receiptModeField")}
                    options={receiptOptions}
                    value={tier.receiptMode}
                    onValueChange={v => updateTier(tier.key, { receiptMode: v as "NONE" | "FULL" | "PARTIAL" })}
                  />
                </div>
                {tier.receiptMode === "PARTIAL" && (
                  <div className="w-40 space-y-1">
                    <CurrencyField
                      label={t("ineligibleAmountField")}
                      value={tier.ineligibleAmount ?? 0}
                      onChange={v => updateTier(tier.key, { ineligibleAmount: v })}
                    />
                    <p className="text-xs text-muted-foreground">
                      {tier.freeAmount ? t("eligibleAmountAutoHint", {
                        amount: (tier.ineligibleAmount ?? 0).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }),
                      }) : t("eligibleAmountPreview", {
                        amount: Math.max(0, (tier.amount ?? 0) - (tier.ineligibleAmount ?? 0)).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }),
                      })}
                    </p>
                    {/* Sans minimum configuré, un don en dessous du montant non éligible sera
                        bloqué au paiement (voir checkout/route.ts) — mieux vaut que le
                        gestionnaire le sache en configurant le palier. */}
                    {tier.freeAmount && !tier.amount && !!tier.ineligibleAmount && (
                      <p className="text-xs text-destructive">
                        {t("noMinimumWarning", {
                          amount: tier.ineligibleAmount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" }),
                        })}
                      </p>
                    )}
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
