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

type MembreType = { id: string; name: string; color: string }
type ItemType = "MEMBERSHIP" | "ADDON" | "DONATION"

type MembershipTierDraft = {
  id?: string
  itemType: ItemType
  kind: "ONE_OFF" | "RECURRING"
  free: boolean
  freeAmount: boolean
  amount: number | null
  // null = comportement historique (adhésion valable pour l'année civile). Un nombre =
  // validité de durationMonths mois à partir du paiement — voir Cotisation.periodEnd.
  durationMonths: number | null
  label: string
  membreTypeId: string | null
}
type MembershipTier = MembershipTierDraft & { id: string; order: number }

let nextTempId = 0

export function MembershipTiersEditor({ formId, membreTypes }: { formId: string; membreTypes: MembreType[] }) {
  const t       = useTranslations("membershipForms.detail.steps.tiers")
  const tCommon = useTranslations("common")
  const qc      = useQueryClient()

  const { data, isLoading } = useQuery<MembershipTier[]>({
    queryKey: ["membership-form", formId, "tiers"],
    queryFn:  () => fetch(`/api/membership-forms/${formId}/tiers`).then(r => r.json()),
  })

  const saveMutation = useMutation({
    mutationFn: async (tiers: (MembershipTierDraft & { order: number })[]) => {
      const res = await fetch(`/api/membership-forms/${formId}/tiers`, {
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
      return res.json() as Promise<MembershipTier[]>
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["membership-form", formId, "tiers"] }),
  })

  const [tiers, setTiers] = useState<(MembershipTierDraft & { key: string })[]>([])

  useEffect(() => { if (data) setTiers(data.map(t => ({ ...t, key: t.id }))) }, [data])

  function addTier() {
    setTiers(prev => [...prev, { key: `new-${nextTempId++}`, itemType: "MEMBERSHIP", kind: "ONE_OFF", free: false, freeAmount: false, amount: null, durationMonths: null, label: "", membreTypeId: null }])
  }
  function updateTier(key: string, patch: Partial<MembershipTierDraft>) {
    setTiers(prev => prev.map(t => t.key === key ? { ...t, ...patch } : t))
  }
  // Mirrors the server-side normalization in [id]/tiers/route.ts — keeps the preview coherent
  // instead of showing fields that a save would silently discard.
  function updateItemType(key: string, itemType: ItemType) {
    setTiers(prev => prev.map(t => {
      if (t.key !== key) return t
      if (itemType === "MEMBERSHIP") return { ...t, itemType }
      if (itemType === "ADDON") return { ...t, itemType, kind: "ONE_OFF", membreTypeId: null, free: false, durationMonths: null }
      return { ...t, itemType, kind: "ONE_OFF", membreTypeId: null, free: false, freeAmount: true, durationMonths: null }
    }))
  }
  function removeTier(key: string) {
    setTiers(prev => prev.filter(t => t.key !== key))
  }

  async function handleSave() {
    if (tiers.some(t => !t.label.trim())) {
      toast.error(t("labelRequiredError"))
      return
    }
    if (tiers.some(t => !t.free && !t.freeAmount && !t.amount)) {
      toast.error(t("amountRequiredError"))
      return
    }
    if (tiers.some(t => t.free && t.freeAmount)) {
      toast.error(t("freeAndFreeAmountError"))
      return
    }
    if (!tiers.some(t => t.itemType === "MEMBERSHIP")) {
      toast.error(t("membershipTierRequiredError"))
      return
    }
    // Une donation reste à montant libre mais garde son propre champ "amount" comme montant
    // minimum — contrairement à un tarif/option à montant libre classique, où ce champ n'a
    // pas de sens et doit être vidé (voir la ligne juste en dessous).
    if (tiers.some(t => t.itemType === "DONATION" && !t.amount)) {
      toast.error(t("minAmountRequiredError"))
      return
    }
    // Stripe recurring prices cap interval_count at 12 for a "month" interval — see the same
    // rule enforced server-side in [id]/tiers/route.ts.
    if (tiers.some(t => t.kind === "RECURRING" && (t.durationMonths ?? 0) > 12)) {
      toast.error(t("durationMonthsRecurringMaxError"))
      return
    }
    try {
      await saveMutation.mutateAsync(tiers.map((t, order) => ({
        id: t.id, order, itemType: t.itemType, kind: t.kind, free: t.free,
        freeAmount: t.free ? false : t.freeAmount,
        amount: t.free || (t.freeAmount && t.itemType !== "DONATION") ? null : t.amount,
        durationMonths: t.itemType === "MEMBERSHIP" ? t.durationMonths : null,
        label: t.label, membreTypeId: t.membreTypeId,
      })))
      toast.success(t("saved"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tCommon("error"))
    }
  }

  const itemTypeOptions = [
    { value: "MEMBERSHIP", label: t("itemTypeMembership") },
    { value: "ADDON",      label: t("itemTypeAddon") },
    { value: "DONATION",   label: t("itemTypeDonation") },
  ]
  const kindOptions = [
    { value: "ONE_OFF",   label: t("kindOneOff") },
    { value: "RECURRING", label: t("kindRecurring") },
  ]
  const membreTypeOptions = [
    { value: "", label: t("membreTypeNone") },
    ...membreTypes.map(mt => ({ value: mt.id, label: mt.name })),
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
              <div className="flex items-end gap-3 flex-wrap">
                <div className="max-w-sm flex-1 min-w-48">
                  <FormField
                    label={t("labelField")}
                    placeholder={t("labelPlaceholder")}
                    value={tier.label}
                    onChange={e => updateTier(tier.key, { label: e.target.value })}
                  />
                </div>
                <div className="w-44">
                  <SelectField
                    label={t("itemTypeField")}
                    options={itemTypeOptions}
                    value={tier.itemType}
                    onValueChange={v => updateItemType(tier.key, v as ItemType)}
                  />
                </div>
              </div>
              {tier.itemType === "MEMBERSHIP" && (
                <div className="flex items-end gap-3 flex-wrap">
                  <div className="w-48">
                    <SelectField
                      label={t("kindField")}
                      options={kindOptions}
                      value={tier.kind}
                      onValueChange={v => updateTier(tier.key, {
                        kind: v as "ONE_OFF" | "RECURRING",
                        // Stripe's recurring interval_count caps at 12 (see tiers/route.ts) —
                        // clamped immediately instead of only surfacing as a save-time toast,
                        // so the field itself reflects the new constraint right away.
                        durationMonths: v === "RECURRING" && (tier.durationMonths ?? 0) > 12 ? 12 : tier.durationMonths,
                      })}
                      disabled={tier.free}
                    />
                  </div>
                  <div className="w-48">
                    <SelectField
                      label={t("membreTypeField")}
                      options={membreTypeOptions}
                      value={tier.membreTypeId ?? ""}
                      onValueChange={v => updateTier(tier.key, { membreTypeId: v || null })}
                    />
                  </div>
                  <div className="w-40">
                    <FormField
                      label={t("durationMonthsField")}
                      type="number"
                      min={1}
                      max={tier.kind === "RECURRING" ? 12 : 60}
                      placeholder={t("durationMonthsPlaceholder")}
                      value={tier.durationMonths ?? ""}
                      onChange={e => updateTier(tier.key, { durationMonths: e.target.value ? Number(e.target.value) : null })}
                      hint={tier.kind === "RECURRING" ? t("durationMonthsHintRecurring") : t("durationMonthsHint")}
                    />
                  </div>
                </div>
              )}
              <div className="flex items-end gap-3 flex-wrap">
                <div className="w-40">
                  <CurrencyField
                    label={tier.itemType === "DONATION" ? t("minAmountField") : t("amountField")}
                    value={tier.amount ?? 0}
                    onChange={v => updateTier(tier.key, { amount: v })}
                    disabled={tier.free || (tier.freeAmount && tier.itemType !== "DONATION")}
                  />
                </div>
                <div className="pb-2.5 flex items-center gap-3">
                  {tier.itemType !== "DONATION" && (
                    <CheckboxField
                      label={t("freeAmountField")}
                      checked={tier.freeAmount}
                      onChange={e => updateTier(tier.key, { freeAmount: e.target.checked, free: e.target.checked ? false : tier.free })}
                      disabled={tier.free}
                    />
                  )}
                  {tier.itemType === "MEMBERSHIP" && (
                    <CheckboxField
                      label={t("freeField")}
                      checked={tier.free}
                      onChange={e => updateTier(tier.key, {
                        free: e.target.checked,
                        freeAmount: e.target.checked ? false : tier.freeAmount,
                        kind: e.target.checked ? "ONE_OFF" : tier.kind,
                      })}
                    />
                  )}
                </div>
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
