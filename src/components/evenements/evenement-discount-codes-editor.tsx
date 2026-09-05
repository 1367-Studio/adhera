"use client"

import { useEffect, useImperativeHandle, useState, type Ref } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { PlusIcon, TrashIcon } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { CheckboxField } from "@/components/ui/checkbox-field"
import {
  useEvenementDiscountCodes, useSaveEvenementDiscountCodes, type EvenementDiscountCodeDraft,
} from "@/hooks/use-evenements"
import type { TicketTypeDraftRow } from "@/components/evenements/evenement-ticket-types-editor"

type Props = {
  evenementId: string
  // Le brouillon en direct de l'éditeur de tarifs voisin (pas la liste déjà enregistrée) —
  // voir onDraftChange dans evenement-ticket-types-editor.tsx. Only TICKET rows can be
  // targeted — voir le commentaire du champ ticketTypeIds dans schema.prisma (un code ne
  // s'applique jamais à une tarif DONATION).
  ticketTypes:   TicketTypeDraftRow[]
  onDirtyChange?: (dirty: boolean) => void
  ref?: Ref<EvenementDiscountCodesEditorHandle>
}

export type EvenementDiscountCodesEditorHandle = { save: () => Promise<boolean> }

let nextTempId = 0

function codesSignature(rows: EvenementDiscountCodeDraft[]): string {
  return JSON.stringify(rows.map(c => [c.code, c.kind, c.value, c.startsAt, c.endsAt, c.maxUses, c.active, [...c.ticketTypeIds].sort()]))
}

function toDatetimeLocal(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
function fromDatetimeLocal(value: string | null): string {
  return value ? new Date(value).toISOString() : ""
}

export function EvenementDiscountCodesEditor({ evenementId, ticketTypes, onDirtyChange, ref }: Props) {
  const t = useTranslations("evenements.discountCodes")
  const tCommon = useTranslations("common")
  const { data, isLoading } = useEvenementDiscountCodes(evenementId)
  const saveMutation = useSaveEvenementDiscountCodes(evenementId)

  const [codes, setCodes] = useState<(EvenementDiscountCodeDraft & { key: string; usesCount: number })[]>([])

  useEffect(() => {
    if (data) setCodes(data.map(c => ({
      id: c.id, key: c.id, code: c.code, kind: c.kind, value: Number(c.value),
      startsAt: toDatetimeLocal(c.startsAt), endsAt: toDatetimeLocal(c.endsAt),
      maxUses: c.maxUses, active: c.active, ticketTypeIds: c.ticketTypeIds, usesCount: c.usesCount,
    })))
  }, [data])

  const savedSignature = codesSignature((data ?? []).map(c => ({
    id: c.id, code: c.code, kind: c.kind, value: Number(c.value),
    startsAt: toDatetimeLocal(c.startsAt), endsAt: toDatetimeLocal(c.endsAt),
    maxUses: c.maxUses, active: c.active, ticketTypeIds: c.ticketTypeIds,
  })))
  const isDirty = codesSignature(codes) !== savedSignature
  useEffect(() => { onDirtyChange?.(isDirty) }, [isDirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])
  useImperativeHandle(ref, () => ({ save: handleSave }))

  function addCode() {
    setCodes(prev => [...prev, {
      key: `new-${nextTempId++}`, code: "", kind: "PERCENT", value: 10,
      startsAt: "", endsAt: "", maxUses: null, active: true, ticketTypeIds: [], usesCount: 0,
    }])
  }

  function updateCode(key: string, patch: Partial<EvenementDiscountCodeDraft>) {
    setCodes(prev => prev.map(c => c.key === key ? { ...c, ...patch } : c))
  }

  function toggleTicketType(key: string, ticketTypeId: string, checked: boolean) {
    setCodes(prev => prev.map(c => c.key === key
      ? { ...c, ticketTypeIds: checked ? [...c.ticketTypeIds, ticketTypeId] : c.ticketTypeIds.filter(id => id !== ticketTypeId) }
      : c))
  }

  function removeCode(key: string) {
    setCodes(prev => prev.filter(c => c.key !== key))
  }

  async function handleSave(): Promise<boolean> {
    if (codes.some(c => !c.code.trim())) {
      toast.error(t("codeRequiredError"))
      return false
    }
    const normalized = codes.map(c => c.code.trim().toUpperCase())
    if (new Set(normalized).size !== normalized.length) {
      toast.error(t("duplicateCodeError"))
      return false
    }
    if (codes.some(c => c.kind === "PERCENT" && c.value > 100)) {
      toast.error(t("percentTooHighError"))
      return false
    }
    if (codes.some(c => c.value <= 0)) {
      toast.error(t("valueRequiredError"))
      return false
    }
    if (codes.some(c => c.startsAt && c.endsAt && c.startsAt >= c.endsAt)) {
      toast.error(t("windowInvalidError"))
      return false
    }
    try {
      await saveMutation.mutateAsync(codes.map(c => ({
        id: c.id, code: c.code.trim().toUpperCase(), kind: c.kind, value: c.value,
        startsAt: fromDatetimeLocal(c.startsAt), endsAt: fromDatetimeLocal(c.endsAt),
        maxUses: c.maxUses, active: c.active, ticketTypeIds: c.ticketTypeIds,
      })))
      toast.success(t("saved"))
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tCommon("error"))
      return false
    }
  }

  const kindOptions = [
    { value: "PERCENT", label: t("kindPercent") },
    { value: "FIXED",   label: t("kindFixed") },
  ]
  // Une tarif tout juste ajoutée dans l'éditeur voisin n'a pas encore de vrai id tant qu'elle
  // n'a pas été enregistrée — pas la peine de l'ajouter ici avant que se soit fait.
  const ticketRows = ticketTypes.filter((tt): tt is TicketTypeDraftRow & { id: string } => tt.itemType === "TICKET" && !!tt.id)

  // Une remise qui fait passer le prix sous le montant non éligible d'une tarif à reçu
  // partiel rend ce reçu inutile (0 € déductible) sans que rien ne le signale ailleurs — les
  // deux éditeurs ne se parlent normalement pas au niveau des valeurs, juste des id/labels.
  function targetsWorthlessPartialReceipt(code: (typeof codes)[number]): boolean {
    const targets = code.ticketTypeIds.length === 0 ? ticketRows : ticketRows.filter(tt => code.ticketTypeIds.includes(tt.id))
    return targets.some(tt => {
      if (tt.receiptMode !== "PARTIAL" || !tt.ineligibleAmount) return false
      const discounted = code.kind === "PERCENT" ? tt.price * (1 - code.value / 100) : tt.price - code.value
      return discounted < tt.ineligibleAmount
    })
  }

  if (isLoading) return null

  return (
    <div className="space-y-4 border-t border-input pt-4">
      <div>
        <h3 className="text-sm font-medium">{t("title")}</h3>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>

      {codes.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("noCodes")}</p>
      )}

      <div className="space-y-3">
        {codes.map(code => (
          <div key={code.key} className="flex items-start gap-2 rounded-md border border-input p-3">
            <div className="flex-1 space-y-2">
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  label={t("codeLabel")}
                  placeholder={t("codePlaceholder")}
                  value={code.code}
                  onChange={e => updateCode(code.key, { code: e.target.value.toUpperCase() })}
                />
                <div className="pb-2.5 flex items-end">
                  <CheckboxField
                    label={t("activeField")}
                    checked={code.active}
                    onChange={e => updateCode(code.key, { active: e.target.checked })}
                  />
                </div>
              </div>
              {code.usesCount > 0 && (
                <p className="text-xs text-muted-foreground">{t("usesCount", { count: code.usesCount })}</p>
              )}
              <div className="grid grid-cols-2 gap-3">
                <SelectField
                  label={t("kindField")}
                  options={kindOptions}
                  value={code.kind}
                  onValueChange={v => updateCode(code.key, { kind: v as "FIXED" | "PERCENT" })}
                />
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {code.kind === "PERCENT" ? t("valuePercentLabel") : t("valueFixedLabel")}
                  </label>
                  <input
                    type="number" min={0.01} step={0.01}
                    value={code.value}
                    onChange={e => updateCode(code.key, { value: parseFloat(e.target.value) || 0 })}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  label={t("startsAtLabel")}
                  type="datetime-local"
                  value={code.startsAt ?? ""}
                  onChange={e => updateCode(code.key, { startsAt: e.target.value })}
                />
                <FormField
                  label={t("endsAtLabel")}
                  type="datetime-local"
                  value={code.endsAt ?? ""}
                  onChange={e => updateCode(code.key, { endsAt: e.target.value })}
                />
              </div>
              <div className="w-40 space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t("maxUsesLabel")} <span className="normal-case text-muted-foreground/70">{t("maxUsesHint")}</span>
                </label>
                <input
                  type="number" min={1} step={1}
                  value={code.maxUses ?? ""}
                  onChange={e => updateCode(code.key, { maxUses: e.target.value === "" ? null : Math.max(1, parseInt(e.target.value, 10)) })}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              {ticketRows.length > 0 && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("applicableTicketTypesLabel")}</label>
                  <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                    {ticketRows.map(tt => (
                      <CheckboxField
                        key={tt.id}
                        label={tt.label || t("codePlaceholder")}
                        checked={code.ticketTypeIds.includes(tt.id)}
                        onChange={e => toggleTicketType(code.key, tt.id, e.target.checked)}
                      />
                    ))}
                  </div>
                  {code.ticketTypeIds.length === 0 && (
                    <p className="text-xs text-muted-foreground">{t("appliesToAllHint")}</p>
                  )}
                  {targetsWorthlessPartialReceipt(code) && (
                    <p className="text-xs text-amber-600 dark:text-amber-500">{t("worthlessPartialReceiptWarning")}</p>
                  )}
                </div>
              )}
            </div>
            <Button type="button" variant="ghost" size="icon" onClick={() => removeCode(code.key)} aria-label={t("removeCode")}>
              <TrashIcon className="size-4" />
            </Button>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between pt-1">
        <Button type="button" variant="outline" size="sm" onClick={addCode}>
          <PlusIcon className="mr-1.5 size-4" />
          {t("addCode")}
        </Button>
        <Button type="button" size="sm" disabled={!isDirty} onClick={handleSave} loading={saveMutation.isPending}>
          {tCommon("save")}
        </Button>
      </div>
    </div>
  )
}
