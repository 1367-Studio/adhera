"use client"

import { useEffect, useImperativeHandle, useState, type Ref } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { PlusIcon, TrashIcon } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { CurrencyField } from "@/components/ui/currency-field"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { useEvenementTicketTypes, useSaveEvenementTicketTypes, type EvenementTicketTypeDraft } from "@/hooks/use-evenements"

// Le sous-ensemble dont l'éditeur de codes promotionnels a besoin pour sa liste "s'applique
// aux tarifs" — un id absent (tarif ajoutée mais pas encore enregistrée) est filtré côté
// parent, une nouvelle tarif ne peut pas encore être ciblée par un code tant qu'elle n'a pas
// de vrai id.
// price/receiptMode/ineligibleAmount ajoutés pour que l'éditeur de codes promotionnels
// puisse avertir quand une remise réduirait le prix sous le montant non éligible d'une tarif
// à reçu partiel (voir le warning dans evenement-discount-codes-editor.tsx).
export type TicketTypeDraftRow = {
  id?: string; label: string; itemType: "TICKET" | "DONATION"
  price: number; receiptMode: "NONE" | "FULL" | "PARTIAL"; ineligibleAmount: number | null
}

type Props = {
  evenementId:   string
  eventCapacity: number | null
  // Reported up so the wizard page can warn before navigating away — see the guard in
  // src/app/dashboard/evenements/[id]/page.tsx.
  onDirtyChange?: (dirty: boolean) => void
  // Reported up live (not just on save) so the discount-codes editor in the same step can
  // target a tarif that was just renamed or added, without waiting for this editor's own
  // Salvar — sinon la liste "s'applique aux tarifs" reste périmée tant que cet éditeur-ci
  // n'a pas été sauvegardé en premier.
  onDraftChange?: (rows: TicketTypeDraftRow[]) => void
  ref?: Ref<EvenementTicketTypesEditorHandle>
}

// Lets the page trigger this editor's save from "Enregistrer et quitter". Resolves to false
// when validation or the request failed — the toast has already been shown by then.
export type EvenementTicketTypesEditorHandle = { save: () => Promise<boolean> }

let nextTempId = 0

// Mirrors the handleSave() payload — see the same helper in membership-tiers-editor.tsx.
function typesSignature(rows: EvenementTicketTypeDraft[]): string {
  return JSON.stringify(rows.map(t => [t.itemType, t.label, t.price, t.priceBeforeDiscount, t.capacity, t.receiptMode, t.ineligibleAmount, t.active, t.opensAt, t.closesAt]))
}

// Same conversion as the wizard page's own toDatetimeLocal/fromDatetimeLocal (see
// src/app/dashboard/evenements/[id]/page.tsx) — duplicated here rather than shared, same as
// that file already duplicates it from evenements-view.tsx. A <input type="datetime-local">
// value has no timezone, so round-tripping through Date's LOCAL getters (not slicing the
// stored UTC ISO string) is required to avoid silently shifting the displayed hour.
function toDatetimeLocal(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromDatetimeLocal(value: string | null): string {
  return value ? new Date(value).toISOString() : ""
}

export function EvenementTicketTypesEditor({ evenementId, eventCapacity, onDirtyChange, onDraftChange, ref }: Props) {
  const t = useTranslations("evenements.ticketTypes")
  const tCommon = useTranslations("common")
  const { data, isLoading } = useEvenementTicketTypes(evenementId)
  const saveMutation = useSaveEvenementTicketTypes(evenementId)

  const [types, setTypes] = useState<(EvenementTicketTypeDraft & { key: string; occupied: number })[]>([])

  useEffect(() => {
    if (data) setTypes(data.map(tt => ({
      id: tt.id, key: tt.id, itemType: tt.itemType, label: tt.label, price: Number(tt.price), capacity: tt.capacity, occupied: tt.occupied,
      receiptMode: tt.receiptMode, ineligibleAmount: tt.ineligibleAmount != null ? Number(tt.ineligibleAmount) : null,
      priceBeforeDiscount: tt.priceBeforeDiscount != null ? Number(tt.priceBeforeDiscount) : null,
      active: tt.active,
      opensAt: toDatetimeLocal(tt.opensAt), closesAt: toDatetimeLocal(tt.closesAt),
    })))
  }, [data])

  const savedSignature = typesSignature((data ?? []).map(tt => ({
    id: tt.id, itemType: tt.itemType, label: tt.label, price: Number(tt.price), capacity: tt.capacity,
    receiptMode: tt.receiptMode, ineligibleAmount: tt.ineligibleAmount != null ? Number(tt.ineligibleAmount) : null,
    priceBeforeDiscount: tt.priceBeforeDiscount != null ? Number(tt.priceBeforeDiscount) : null,
    active: tt.active,
    opensAt: toDatetimeLocal(tt.opensAt), closesAt: toDatetimeLocal(tt.closesAt),
  })))
  const isDirty = typesSignature(types) !== savedSignature
  useEffect(() => { onDirtyChange?.(isDirty) }, [isDirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])
  useEffect(() => {
    onDraftChange?.(types.map(tt => ({ id: tt.id, label: tt.label, itemType: tt.itemType, price: tt.price, receiptMode: tt.receiptMode, ineligibleAmount: tt.ineligibleAmount })))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [types])
  useImperativeHandle(ref, () => ({ save: handleSave }))

  function addType() {
    setTypes(prev => [...prev, { key: `new-${nextTempId++}`, itemType: "TICKET", label: "", price: 0, priceBeforeDiscount: null, capacity: null, occupied: 0, receiptMode: "NONE", ineligibleAmount: null, active: true, opensAt: "", closesAt: "" }])
  }

  function updateType(key: string, patch: Partial<EvenementTicketTypeDraft>) {
    setTypes(prev => prev.map(tt => tt.key === key ? { ...tt, ...patch } : tt))
  }

  // Mirrors membership-tiers-editor.tsx's updateItemType() — switching to DONATION forces
  // the fields that only make sense for a normal ticket back to their neutral values instead
  // of silently keeping a stale capacity/discount/PARTIAL-receipt combination around.
  function updateItemType(key: string, itemType: "TICKET" | "DONATION") {
    setTypes(prev => prev.map(tt => tt.key === key ? {
      ...tt, itemType, capacity: null, priceBeforeDiscount: null,
      receiptMode: itemType === "DONATION" && tt.receiptMode === "PARTIAL" ? "FULL" : tt.receiptMode,
      ineligibleAmount: itemType === "DONATION" ? null : tt.ineligibleAmount,
    } : tt))
  }

  function removeType(key: string) {
    setTypes(prev => prev.filter(tt => tt.key !== key))
  }

  async function handleSave(): Promise<boolean> {
    if (types.some(tt => !tt.label.trim())) {
      toast.error(t("labelRequiredError"))
      return false
    }
    if (types.some(tt => tt.receiptMode === "PARTIAL" && !tt.ineligibleAmount)) {
      toast.error(t("ineligibleAmountRequiredError"))
      return false
    }
    if (types.some(tt => tt.receiptMode === "PARTIAL" && tt.ineligibleAmount != null && tt.ineligibleAmount > tt.price)) {
      toast.error(t("ineligibleAmountExceedsError"))
      return false
    }
    if (types.some(tt => tt.priceBeforeDiscount != null && tt.priceBeforeDiscount <= tt.price)) {
      toast.error(t("priceBeforeDiscountTooLowError"))
      return false
    }
    if (types.some(tt => tt.opensAt && tt.closesAt && tt.opensAt >= tt.closesAt)) {
      toast.error(t("windowInvalidError"))
      return false
    }
    try {
      const result = await saveMutation.mutateAsync(types.map(tt => ({
        id: tt.id, itemType: tt.itemType, label: tt.label, price: tt.price, capacity: tt.itemType === "DONATION" ? null : tt.capacity,
        receiptMode: tt.receiptMode, ineligibleAmount: tt.receiptMode === "PARTIAL" ? tt.ineligibleAmount : null,
        priceBeforeDiscount: tt.itemType === "DONATION" ? null : tt.priceBeforeDiscount,
        active: tt.active,
        opensAt: fromDatetimeLocal(tt.opensAt), closesAt: fromDatetimeLocal(tt.closesAt),
      })))
      toast.success(t("saved"))
      // Non bloquant par design (voir le commentaire de ticketTypeIds dans schema.prisma) —
      // mais l'admin doit savoir qu'un code promo vient de perdre sa cible.
      if (result.affectedDiscountCodes.length > 0) {
        toast.warning(t("affectedDiscountCodesWarning", { codes: result.affectedDiscountCodes.join(", ") }))
      }
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tCommon("error"))
      return false
    }
  }

  const receiptOptions = [
    { value: "NONE",    label: t("receiptNone") },
    { value: "FULL",    label: t("receiptFull") },
    { value: "PARTIAL", label: t("receiptPartial") },
  ]

  if (isLoading) return <p className="text-sm text-muted-foreground">{tCommon("loading")}</p>

  // DONATION rows never carry a capacity of their own (forced null) — only real tickets
  // count toward the event-wide capacity comparison below.
  const ticketRows    = types.filter(tt => tt.itemType === "TICKET")
  const capacitySum   = ticketRows.length > 0 && ticketRows.every(tt => tt.capacity != null) ? ticketRows.reduce((sum, tt) => sum + (tt.capacity ?? 0), 0) : null
  const exceedsEventCapacity = eventCapacity != null && capacitySum != null && capacitySum > eventCapacity

  const itemTypeOptions = [
    { value: "TICKET",   label: t("itemTypeTicket") },
    { value: "DONATION", label: t("itemTypeDonation") },
  ]

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">{t("description")}</p>

      {types.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("noTypes")}</p>
      )}

      <div className="space-y-3">
        {types.map(ticketType => {
          const belowOccupied = ticketType.capacity != null && ticketType.capacity < ticketType.occupied
          return (
            <div key={ticketType.key} className="flex items-start gap-2 rounded-md border border-input p-3">
              <div className="flex-1 space-y-2">
                <div className="flex items-end gap-3">
                  <div className="w-52">
                    <SelectField
                      label={t("itemTypeField")}
                      options={itemTypeOptions}
                      value={ticketType.itemType}
                      onValueChange={v => updateItemType(ticketType.key, v as "TICKET" | "DONATION")}
                    />
                  </div>
                  <div className="pb-2.5">
                    <CheckboxField
                      label={t("activeField")}
                      checked={ticketType.active}
                      onChange={e => updateType(ticketType.key, { active: e.target.checked })}
                    />
                  </div>
                </div>
                <FormField
                  label={t("typeLabel")}
                  placeholder={t("typeLabelPlaceholder")}
                  value={ticketType.label}
                  onChange={e => updateType(ticketType.key, { label: e.target.value })}
                />
                {ticketType.occupied > 0 && (
                  <p className="text-xs text-muted-foreground">{t("occupiedCount", { count: ticketType.occupied })}</p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <CurrencyField
                    label={ticketType.itemType === "DONATION" ? t("minAmountField") : t("priceLabel")}
                    value={ticketType.price}
                    onChange={v => updateType(ticketType.key, { price: v })}
                  />
                  {ticketType.itemType === "TICKET" && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {t("capacityLabel")} <span className="normal-case text-muted-foreground/70">{t("capacityHint")}</span>
                      </label>
                      <input
                        type="number" min={1} step={1}
                        value={ticketType.capacity ?? ""}
                        onChange={e => updateType(ticketType.key, { capacity: e.target.value === "" ? null : Math.max(1, parseInt(e.target.value, 10)) })}
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      />
                    </div>
                  )}
                </div>
                {belowOccupied && (
                  <p className="text-xs text-amber-600 dark:text-amber-500">{t("capacityBelowOccupiedWarning", { count: ticketType.occupied })}</p>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    label={t("opensAtLabel")}
                    type="datetime-local"
                    value={ticketType.opensAt ?? ""}
                    onChange={e => updateType(ticketType.key, { opensAt: e.target.value })}
                  />
                  <FormField
                    label={t("closesAtLabel")}
                    type="datetime-local"
                    value={ticketType.closesAt ?? ""}
                    onChange={e => updateType(ticketType.key, { closesAt: e.target.value })}
                  />
                </div>
                {ticketType.itemType === "TICKET" && (
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={ticketType.priceBeforeDiscount != null}
                        onChange={e => updateType(ticketType.key, { priceBeforeDiscount: e.target.checked ? ticketType.price + 1 : null })}
                      />
                      {t("showDiscountField")}
                    </label>
                    {ticketType.priceBeforeDiscount != null && (
                      <div className="w-40">
                        <CurrencyField
                          label={t("priceBeforeDiscountField")}
                          value={ticketType.priceBeforeDiscount}
                          onChange={v => updateType(ticketType.key, { priceBeforeDiscount: v })}
                        />
                      </div>
                    )}
                  </div>
                )}
                <div className="flex items-end gap-3 flex-wrap">
                  <div className="w-52">
                    <SelectField
                      label={t("receiptModeField")}
                      options={ticketType.itemType === "DONATION" ? receiptOptions.filter(o => o.value !== "PARTIAL") : receiptOptions}
                      value={ticketType.receiptMode}
                      onValueChange={v => updateType(ticketType.key, { receiptMode: v as "NONE" | "FULL" | "PARTIAL", ineligibleAmount: v === "PARTIAL" ? ticketType.ineligibleAmount : null })}
                    />
                  </div>
                  {ticketType.receiptMode === "PARTIAL" && (
                    <div className="w-40 space-y-1">
                      <CurrencyField
                        label={t("ineligibleAmountField")}
                        value={ticketType.ineligibleAmount ?? 0}
                        onChange={v => updateType(ticketType.key, { ineligibleAmount: v })}
                      />
                      <p className="text-xs text-muted-foreground">
                        {t("eligibleAmountPreview", {
                          amount: Math.max(0, ticketType.price - (ticketType.ineligibleAmount ?? 0)).toLocaleString("fr-FR", { style: "currency", currency: "EUR" }),
                        })}
                      </p>
                    </div>
                  )}
                </div>
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => removeType(ticketType.key)} aria-label={t("removeType")}>
                <TrashIcon className="size-4" />
              </Button>
            </div>
          )
        })}
      </div>

      <div className="flex items-center justify-between pt-1">
        <Button type="button" variant="outline" size="sm" onClick={addType}>
          <PlusIcon className="mr-1.5 size-4" />
          {t("addType")}
        </Button>
        <Button type="button" size="sm" disabled={!isDirty} onClick={handleSave} loading={saveMutation.isPending}>
          {tCommon("save")}
        </Button>
      </div>

      {exceedsEventCapacity && (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          {t("capacitySumExceedsEventWarning", { sum: capacitySum ?? 0, eventCapacity: eventCapacity ?? 0 })}
        </p>
      )}
    </div>
  )
}
