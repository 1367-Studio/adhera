"use client"

import { useEffect, useImperativeHandle, useState, type ReactNode, type Ref } from "react"
import { DateField } from "@/components/ui/date-field"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core"
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers"
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { DotsSixIcon, PlusIcon, TrashIcon } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { CurrencyField } from "@/components/ui/currency-field"
import { cn } from "@/lib/utils"

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
  // Mutuellement exclusif avec fixedPeriodEnd.
  durationMonths: number | null
  // Alternative à durationMonths — date de fin absolue (YYYY-MM-DD), identique pour tout le
  // monde peu importe la date de paiement (ex. saison sportive).
  fixedPeriodEnd: string | null
  receiptMode: "NONE" | "FULL" | "PARTIAL"
  ineligibleAmount: number | null
  installmentsAllowed: boolean
  installmentsCount: number | null
  label: string
  membreTypeId: string | null
}
type MembershipTier = MembershipTierDraft & { id: string; order: number }

let nextTempId = 0

// Exactly the fields handleSave() persists, in list order (the order itself is saved as
// `order`). Anything editable but missing here would be silently lost by the unsaved-changes
// guard in the parent page, so this must stay in sync with the mutation payload below.
function tiersSignature(rows: MembershipTierDraft[]): string {
  return JSON.stringify(rows.map(t => [
    t.itemType, t.kind, t.free, t.freeAmount, t.amount, t.durationMonths, t.fixedPeriodEnd,
    t.receiptMode, t.ineligibleAmount, t.installmentsAllowed, t.installmentsCount, t.label, t.membreTypeId,
  ]))
}

// Lets the page trigger this editor's save from "Enregistrer et quitter". Resolves to false
// when validation or the request failed — the toast has already been shown by then.
export type MembershipTiersEditorHandle = { save: () => Promise<boolean> }

// One draggable tier card. The grip sits in a left rail rather than floating over the card,
// so it never lands on top of a field at narrow widths, and it stays clear of the delete
// button at the other end of the row. Only the grip carries the drag listeners — the card is
// full of inputs a pointer-down anywhere else must still reach.
function SortableTierCard({ id, dragLabel, action, children }: {
  id: string
  dragLabel: string
  // Pinned to its own rail on the right, mirroring the grip on the left. Left inside the
  // fields' flex flow it would land at the end of whatever line wrapped last, which moves
  // the delete button around as the form's controls appear and disappear.
  action?: ReactNode
  children: ReactNode
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id })

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      // Lifted above its neighbours while dragging — without it the card being moved slides
      // under the ones it passes over.
      className={cn("flex items-start gap-3 rounded-md border border-input p-4", isDragging && "relative z-10 opacity-60")}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        // Registered as the activator so a keyboard drag returns focus to the grip on drop,
        // rather than to the card, which isn't focusable.
        ref={setActivatorNodeRef}
        aria-label={dragLabel}
        title={dragLabel}
        // mt-5 clears the label above the first field, so the grip lines up with the input
        // box itself (both h-9) rather than with the top of the card.
        className="mt-5 shrink-0 cursor-grab text-muted-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <DotsSixIcon />
      </Button>
      <div className="min-w-0 flex-1">{children}</div>
      {action && <div className="mt-5 shrink-0">{action}</div>}
    </div>
  )
}

export function MembershipTiersEditor({ formId, membreTypes, onDirtyChange, ref }: {
  formId: string
  membreTypes: MembreType[]
  // Reported up so the page can warn before navigating away — see the guard in
  // src/app/dashboard/adhesions/[id]/page.tsx.
  onDirtyChange?: (dirty: boolean) => void
  ref?: Ref<MembershipTiersEditorHandle>
}) {
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

  // fixedPeriodEnd comes back from the API as a full ISO datetime — sliced to YYYY-MM-DD for
  // the <input type="date"> below, re-expanded to end-of-day ISO on save (see handleSave).
  // amount/ineligibleAmount come back as strings too — Prisma's Decimal serializes to JSON
  // as a string, not a number, so the PUT below would 422 ("expected number, received
  // string") the moment a tier is saved again without its CurrencyField ever being touched
  // (which is the only place that turns the value back into a real number — see onChange).
  function normalizeTier(t: MembershipTier) {
    return {
      ...t,
      amount:           t.amount != null ? Number(t.amount) : null,
      ineligibleAmount: t.ineligibleAmount != null ? Number(t.ineligibleAmount) : null,
      fixedPeriodEnd:   t.fixedPeriodEnd ? t.fixedPeriodEnd.slice(0, 10) : null,
    }
  }

  useEffect(() => {
    if (data) setTiers(data.map(t => ({ ...normalizeTier(t), key: t.id })))
  }, [data])

  // Same normalization the hydration effect above applies, so an untouched list compares
  // equal (fixedPeriodEnd arrives as a full ISO datetime but is edited as YYYY-MM-DD, amount/
  // ineligibleAmount arrive as Decimal strings but are edited as numbers).
  const isDirty = tiersSignature(tiers) !== tiersSignature((data ?? []).map(normalizeTier))
  useEffect(() => { onDirtyChange?.(isDirty) }, [isDirty, onDirtyChange])
  // Unmounting means the local edits are gone anyway — leaving the flag set would block
  // navigation over work that no longer exists.
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])
  useImperativeHandle(ref, () => ({ save: handleSave }))

  // 8px before a drag starts, so a plain click on the grip (or a small drift while clicking
  // a field) isn't read as the beginning of a reorder.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function addTier() {
    setTiers(prev => [...prev, {
      key: `new-${nextTempId++}`, itemType: "MEMBERSHIP", kind: "ONE_OFF", free: false, freeAmount: false, amount: null,
      durationMonths: null, fixedPeriodEnd: null, receiptMode: "NONE", ineligibleAmount: null,
      installmentsAllowed: false, installmentsCount: 3, label: "", membreTypeId: null,
    }])
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
      if (itemType === "ADDON") return { ...t, itemType, kind: "ONE_OFF", membreTypeId: null, free: false, durationMonths: null, fixedPeriodEnd: null, receiptMode: "NONE" as const, ineligibleAmount: null, installmentsAllowed: false, installmentsCount: null }
      // Une donation reste éligible au reçu fiscal par défaut, comme sur AssoConnect — voir
      // le panneau "Reçus fiscaux" de sa formule de type Dons.
      return { ...t, itemType, kind: "ONE_OFF", membreTypeId: null, free: false, freeAmount: true, durationMonths: null, fixedPeriodEnd: null, receiptMode: "FULL" as const, ineligibleAmount: null, installmentsAllowed: false, installmentsCount: null }
    }))
  }
  function removeTier(key: string) {
    setTiers(prev => prev.filter(t => t.key !== key))
  }

  // The list order IS the saved order — handleSave writes each row's index into `order`, and
  // the public form renders tiers by that same `order` (see the public route's orderBy).
  // Moving a card is therefore the whole reorder; nothing else needs to be kept in sync.
  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    setTiers(prev => {
      const from = prev.findIndex(t => t.key === active.id)
      const to   = prev.findIndex(t => t.key === over.id)
      return from === -1 || to === -1 ? prev : arrayMove(prev, from, to)
    })
  }

  async function handleSave(): Promise<boolean> {
    if (tiers.some(t => !t.label.trim())) {
      toast.error(t("labelRequiredError"))
      return false
    }
    if (tiers.some(t => !t.free && !t.freeAmount && !t.amount)) {
      toast.error(t("amountRequiredError"))
      return false
    }
    if (tiers.some(t => t.free && t.freeAmount)) {
      toast.error(t("freeAndFreeAmountError"))
      return false
    }
    if (!tiers.some(t => t.itemType === "MEMBERSHIP")) {
      toast.error(t("membershipTierRequiredError"))
      return false
    }
    // Une donation reste à montant libre mais garde son propre champ "amount" comme montant
    // minimum — contrairement à un tarif/option à montant libre classique, où ce champ n'a
    // pas de sens et doit être vidé (voir la ligne juste en dessous).
    if (tiers.some(t => t.itemType === "DONATION" && !t.amount)) {
      toast.error(t("minAmountRequiredError"))
      return false
    }
    // Stripe recurring prices cap interval_count at 12 for a "month" interval — see the same
    // rule enforced server-side in [id]/tiers/route.ts.
    if (tiers.some(t => t.kind === "RECURRING" && (t.durationMonths ?? 0) > 12)) {
      toast.error(t("durationMonthsRecurringMaxError"))
      return false
    }
    if (tiers.some(t => t.durationMonths && t.fixedPeriodEnd)) {
      toast.error(t("durationConflictError"))
      return false
    }
    if (tiers.some(t => t.receiptMode === "PARTIAL" && !t.ineligibleAmount)) {
      toast.error(t("ineligibleAmountRequiredError"))
      return false
    }
    if (tiers.some(t => t.receiptMode === "PARTIAL" && t.amount != null && t.ineligibleAmount != null && t.ineligibleAmount > t.amount)) {
      toast.error(t("ineligibleAmountExceedsError"))
      return false
    }
    try {
      await saveMutation.mutateAsync(tiers.map((t, order) => ({
        id: t.id, order, itemType: t.itemType, kind: t.kind, free: t.free,
        freeAmount: t.free ? false : t.freeAmount,
        // null seulement si gratuit — sinon montant fixe, ou montant minimum optionnel pour un
        // tarif/option/donation à montant libre.
        amount: t.free ? null : t.amount,
        durationMonths: t.itemType === "MEMBERSHIP" ? t.durationMonths : null,
        // End-of-day, not midnight-at-the-start — "valable jusqu'au 31 août" should cover the
        // whole 31st, not expire the instant it begins.
        fixedPeriodEnd: t.itemType === "MEMBERSHIP" && t.fixedPeriodEnd ? new Date(`${t.fixedPeriodEnd}T23:59:59`).toISOString() : null,
        receiptMode:      t.itemType !== "ADDON" ? t.receiptMode : "NONE" as const,
        ineligibleAmount: t.itemType === "MEMBERSHIP" && t.receiptMode === "PARTIAL" ? t.ineligibleAmount : null,
        installmentsAllowed: t.itemType === "MEMBERSHIP" ? t.installmentsAllowed : false,
        installmentsCount:   t.itemType === "MEMBERSHIP" && t.installmentsAllowed ? t.installmentsCount : null,
        label: t.label, membreTypeId: t.membreTypeId,
      })))
      toast.success(t("saved"))
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tCommon("error"))
      return false
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
  const receiptOptions = [
    { value: "NONE",    label: t("receiptNone") },
    { value: "FULL",    label: t("receiptFull") },
    { value: "PARTIAL", label: t("receiptPartial") },
  ]

  if (isLoading) return <p className="text-sm text-muted-foreground">{tCommon("loading")}</p>

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t("hint")}</p>

      {tiers.length === 0 && (
        <p className="text-sm text-muted-foreground">{t("noTiers")}</p>
      )}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={tiers.map(row => row.key)} strategy={verticalListSortingStrategy}>
          <div className="space-y-4">
            {tiers.map(tier => (
              <SortableTierCard
                key={tier.key}
                id={tier.key}
                dragLabel={t("reorderTier")}
                action={
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeTier(tier.key)} aria-label={t("removeTier")}>
                    <TrashIcon className="size-4" />
                  </Button>
                }
              >
                {/* Un seul conteneur flex pour tous les contrôles du tarif. En trois rangées
                    séparées, flex-wrap ne pouvait faire remonter un champ que dans SA rangée :
                    « Montant minimum » retombait sous « Libellé » alors que la ligne du dessus
                    était à moitié vide. Ici tout coule dans la largeur réellement disponible. */}
                <div className="flex items-end gap-x-4 gap-y-5 flex-wrap">
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
                {tier.itemType === "MEMBERSHIP" && (
                  <>
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
                          // A fixed end date doesn't fit a subscription that renews forever.
                          fixedPeriodEnd: v === "RECURRING" ? null : tier.fixedPeriodEnd,
                          // Already spread over time by nature — see tiers/route.ts.
                          installmentsAllowed: v === "RECURRING" ? false : tier.installmentsAllowed,
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
                        id={`tier-duration-${tier.key}`}
                        label={t("durationMonthsField")}
                        type="number"
                        min={1}
                        max={tier.kind === "RECURRING" ? 12 : 60}
                        placeholder={t("durationMonthsPlaceholder")}
                        value={tier.durationMonths ?? ""}
                        onChange={e => updateTier(tier.key, {
                          durationMonths: e.target.value ? Number(e.target.value) : null,
                          fixedPeriodEnd: e.target.value ? null : tier.fixedPeriodEnd,
                        })}
                        disabled={!!tier.fixedPeriodEnd}
                        hintTooltip={tier.kind === "RECURRING" ? t("durationMonthsHintRecurring") : t("durationMonthsHint")}
                      />
                    </div>
                    {tier.kind === "ONE_OFF" && (
                      <div className="w-44">
                        <DateField
                          id={`tier-fixed-period-end-${tier.key}`}
                          label={t("fixedPeriodEndField")}
                          allowFuture
                          value={tier.fixedPeriodEnd ?? ""}
                          onChange={v => updateTier(tier.key, {
                            fixedPeriodEnd: v || null,
                            durationMonths: v ? null : tier.durationMonths,
                          })}
                          disabled={!!tier.durationMonths}
                          hintTooltip={t("fixedPeriodEndHint")}
                        />
                      </div>
                    )}
                  </>
                )}
                  <div className="w-40">
                    <CurrencyField
                      label={tier.itemType === "DONATION" || tier.freeAmount ? t("minAmountField") : t("amountField")}
                      value={tier.amount ?? 0}
                      onChange={v => updateTier(tier.key, { amount: v })}
                      disabled={tier.free}
                    />
                  </div>
                  {tier.itemType !== "DONATION" && (
                    <div className="flex h-9 items-center">
                      <CheckboxField
                        label={t("freeAmountField")}
                        checked={tier.freeAmount}
                        onChange={e => updateTier(tier.key, {
                          freeAmount: e.target.checked, free: e.target.checked ? false : tier.free,
                          // A variable amount has no fixed total to divide into N equal parts.
                          installmentsAllowed: e.target.checked ? false : tier.installmentsAllowed,
                        })}
                        disabled={tier.free}
                      />
                    </div>
                  )}
                  {tier.itemType === "MEMBERSHIP" && (
                    <div className="flex h-9 items-center">
                      <CheckboxField
                        label={t("freeField")}
                        checked={tier.free}
                        onChange={e => updateTier(tier.key, {
                          free: e.target.checked,
                          freeAmount: e.target.checked ? false : tier.freeAmount,
                          kind: e.target.checked ? "ONE_OFF" : tier.kind,
                          // No money changes hands on a free tier — nothing to issue a
                          // tax-deductible receipt for (see tiers/route.ts).
                          receiptMode: e.target.checked ? "NONE" : tier.receiptMode,
                          ineligibleAmount: e.target.checked ? null : tier.ineligibleAmount,
                          installmentsAllowed: e.target.checked ? false : tier.installmentsAllowed,
                        })}
                      />
                    </div>
                  )}
                  {(tier.itemType === "MEMBERSHIP" || tier.itemType === "DONATION") && (
                    <div className="w-52">
                      <SelectField
                        label={t("receiptModeField")}
                        // Une donation embarquée (itemType DONATION) est toujours à montant
                        // libre et n'a pas de montant non éligible configurable — seul un tarif
                        // MEMBERSHIP à montant libre peut être partiellement éligible.
                        options={tier.itemType === "DONATION" ? receiptOptions.filter(o => o.value !== "PARTIAL") : receiptOptions}
                        value={tier.receiptMode}
                        onValueChange={v => updateTier(tier.key, { receiptMode: v as "NONE" | "FULL" | "PARTIAL" })}
                        disabled={tier.free}
                      />
                    </div>
                  )}
                  {tier.itemType === "MEMBERSHIP" && tier.receiptMode === "PARTIAL" && (
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
                      {/* Sans minimum configuré, un visiteur payant moins que le montant non
                          éligible sera bloqué au paiement (voir checkout/route.ts) — mieux vaut
                          que le gestionnaire le sache en configurant le tarif plutôt qu'en
                          recevant une réclamation d'un visiteur bloqué. */}
                      {tier.freeAmount && !tier.amount && !!tier.ineligibleAmount && (
                        <p className="text-xs text-destructive">
                          {t("noMinimumWarning", {
                            amount: tier.ineligibleAmount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" }),
                          })}
                        </p>
                      )}
                    </div>
                  )}
                  {tier.itemType === "MEMBERSHIP" && tier.kind === "ONE_OFF" && !tier.freeAmount && (
                    <div className="flex h-9 items-center">
                      <CheckboxField
                        label={t("installmentsAllowedField")}
                        checked={tier.installmentsAllowed}
                        onChange={e => updateTier(tier.key, { installmentsAllowed: e.target.checked, installmentsCount: e.target.checked ? (tier.installmentsCount ?? 3) : tier.installmentsCount })}
                        disabled={tier.free}
                      />
                    </div>
                  )}
                  {tier.itemType === "MEMBERSHIP" && tier.kind === "ONE_OFF" && !tier.freeAmount && tier.installmentsAllowed && (
                    <div className="w-28">
                      <FormField
                        label={t("installmentsCountField")}
                        type="number"
                        min={2}
                        max={12}
                        value={tier.installmentsCount ?? 3}
                        onChange={e => updateTier(tier.key, { installmentsCount: e.target.value ? Number(e.target.value) : null })}
                      />
                    </div>
                  )}
                </div>
              </SortableTierCard>
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="flex items-center justify-end gap-2 pt-1">
        <Button type="button" variant="outline" size="sm" onClick={addTier}>
          <PlusIcon className="mr-1.5 size-4" />
          {t("addTier")}
        </Button>
        <Button type="button" size="sm" disabled={!isDirty} onClick={handleSave} loading={saveMutation.isPending}>
          {t("saveTiers")}
        </Button>
      </div>
    </div>
  )
}
