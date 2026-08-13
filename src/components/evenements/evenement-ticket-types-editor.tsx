"use client"

import { useEffect, useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { PlusIcon, TrashIcon } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { CurrencyField } from "@/components/ui/currency-field"
import { useEvenementTicketTypes, useSaveEvenementTicketTypes, type EvenementTicketTypeDraft } from "@/hooks/use-evenements"

type Props = {
  evenementId:   string
  eventCapacity: number | null
  onClose:       () => void
}

let nextTempId = 0

export function EvenementTicketTypesEditor({ evenementId, eventCapacity, onClose }: Props) {
  const t = useTranslations("evenements.ticketTypes")
  const tCommon = useTranslations("common")
  const { data, isLoading } = useEvenementTicketTypes(evenementId)
  const saveMutation = useSaveEvenementTicketTypes(evenementId)

  const [types, setTypes] = useState<(EvenementTicketTypeDraft & { key: string; occupied: number })[]>([])

  useEffect(() => {
    if (data) setTypes(data.map(tt => ({ id: tt.id, key: tt.id, label: tt.label, price: Number(tt.price), capacity: tt.capacity, occupied: tt.occupied })))
  }, [data])

  function addType() {
    setTypes(prev => [...prev, { key: `new-${nextTempId++}`, label: "", price: 0, capacity: null, occupied: 0 }])
  }

  function updateType(key: string, patch: Partial<EvenementTicketTypeDraft>) {
    setTypes(prev => prev.map(tt => tt.key === key ? { ...tt, ...patch } : tt))
  }

  function removeType(key: string) {
    setTypes(prev => prev.filter(tt => tt.key !== key))
  }

  async function handleSave() {
    if (types.some(tt => !tt.label.trim())) {
      toast.error(t("labelRequiredError"))
      return
    }
    try {
      await saveMutation.mutateAsync(types.map(tt => ({ id: tt.id, label: tt.label, price: tt.price, capacity: tt.capacity })))
      toast.success(t("saved"))
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tCommon("error"))
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">{tCommon("loading")}</p>

  const capacitySum   = types.every(tt => tt.capacity != null) ? types.reduce((sum, tt) => sum + (tt.capacity ?? 0), 0) : null
  const exceedsEventCapacity = eventCapacity != null && capacitySum != null && capacitySum > eventCapacity

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
                    label={t("priceLabel")}
                    value={ticketType.price}
                    onChange={v => updateType(ticketType.key, { price: v })}
                  />
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
                </div>
                {belowOccupied && (
                  <p className="text-xs text-amber-600 dark:text-amber-500">{t("capacityBelowOccupiedWarning", { count: ticketType.occupied })}</p>
                )}
              </div>
              <Button type="button" variant="ghost" size="icon" onClick={() => removeType(ticketType.key)} aria-label={t("removeType")}>
                <TrashIcon className="size-4" />
              </Button>
            </div>
          )
        })}
      </div>

      <Button type="button" variant="outline" onClick={addType}>
        <PlusIcon className="mr-1.5 size-4" />
        {t("addType")}
      </Button>

      {exceedsEventCapacity && (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          {t("capacitySumExceedsEventWarning", { sum: capacitySum ?? 0, eventCapacity: eventCapacity ?? 0 })}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={saveMutation.isPending}>
          {tCommon("cancel")}
        </Button>
        <Button type="button" onClick={handleSave} loading={saveMutation.isPending}>
          {tCommon("save")}
        </Button>
      </div>
    </div>
  )
}
