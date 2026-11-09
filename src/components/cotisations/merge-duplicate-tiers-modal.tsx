"use client"

import { useEffect, useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import {
  useMembershipTierDuplicates, useMergeMembershipTiers, type DuplicateTierGroup, type DuplicateTierCandidate,
} from "@/hooks/use-cotisations"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Button } from "@/components/ui/button"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { Skeleton } from "@/components/ui/skeleton"
import { CaretLeftIcon, WarningIcon } from "@phosphor-icons/react/dist/ssr"

const fmt = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

function priceLabel(tier: DuplicateTierCandidate, t: ReturnType<typeof useTranslations>): string {
  if (tier.free) return t("priceFree")
  const amount = tier.amount ? fmt(Number(tier.amount)) : null
  if (tier.freeAmount) return amount ? t("priceFreeAmountFrom", { amount }) : t("priceFreeAmount")
  const base = amount ?? t("priceFree")
  return tier.kind === "RECURRING" ? t("priceRecurring", { amount: base }) : base
}

// Suggests groups of MembershipTier rows whose label only differs by case/accents/extra
// whitespace, lets the admin pick which one to keep and which to fold into it, and shows the
// counts that will move before anything is written — see src/lib/membership-tier-merge.ts for
// why this never happens automatically.
export function MergeDuplicateTiersModal({ open, onOpenChange, onMerged }: {
  open:         boolean
  onOpenChange: (open: boolean) => void
  // Lets the caller react to a completed merge — notably, to stop filtering on a tier id
  // that no longer has any cotisations attached to it (see cotisations-view.tsx).
  onMerged?:    (mergedAwayTierIds: string[], primaryTierId: string) => void
}) {
  const t = useTranslations("cotisations.view.mergeTiers")
  const { data: groups, isLoading, isError } = useMembershipTierDuplicates(open)
  const merge = useMergeMembershipTiers()

  const [selectedGroupKey, setSelectedGroupKey] = useState<string | null>(null)
  const [primaryTierId, setPrimaryTierId] = useState<string | null>(null)
  const [secondaryIds, setSecondaryIds] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    if (!open) {
      setSelectedGroupKey(null)
      setPrimaryTierId(null)
      setSecondaryIds(new Set())
      setConfirmOpen(false)
    }
  }, [open])

  const selectedGroup: DuplicateTierGroup | undefined = groups?.find(g => g.normalizedLabel === selectedGroupKey)

  function openGroup(group: DuplicateTierGroup) {
    // Default primary: the tier with the most cotisations — least disruptive choice, since
    // it already carries the most history.
    const byUsage = [...group.tiers].sort((a, b) => b.cotisationCount - a.cotisationCount)
    setSelectedGroupKey(group.normalizedLabel)
    setPrimaryTierId(byUsage[0].id)
    setSecondaryIds(new Set(byUsage.slice(1).map(tier => tier.id)))
  }

  function backToList() {
    setSelectedGroupKey(null)
    setPrimaryTierId(null)
    setSecondaryIds(new Set())
  }

  function toggleSecondary(tierId: string, checked: boolean) {
    setSecondaryIds(prev => {
      const next = new Set(prev)
      if (checked) next.add(tierId)
      else next.delete(tierId)
      return next
    })
  }

  // Switching primary must not wipe a manual uncheck elsewhere in the group (3+-way
  // duplicates): only the new primary (removed, it can't merge into itself) and the OLD
  // primary (added back, since it now needs to be folded in like any other secondary) change.
  function selectPrimary(tierId: string) {
    setSecondaryIds(prev => {
      const next = new Set(prev)
      next.delete(tierId)
      if (primaryTierId) next.add(primaryTierId)
      return next
    })
    setPrimaryTierId(tierId)
  }

  const primaryTier = selectedGroup?.tiers.find(tier => tier.id === primaryTierId)
  const secondaryTiers = selectedGroup?.tiers.filter(tier => secondaryIds.has(tier.id)) ?? []
  const totals = useMemo(() => secondaryTiers.reduce((acc, tier) => ({
    cotisationCount:         acc.cotisationCount + tier.cotisationCount,
    membreCount:             acc.membreCount + tier.membreCount,
    activeSubscriptionCount: acc.activeSubscriptionCount + tier.activeSubscriptionCount,
  }), { cotisationCount: 0, membreCount: 0, activeSubscriptionCount: 0 }), [secondaryTiers])

  async function handleConfirmMerge() {
    if (!primaryTier) return
    const mergedAwayIds: string[] = []
    try {
      for (const secondary of secondaryTiers) {
        await merge.mutateAsync({ primaryTierId: primaryTier.id, secondaryTierId: secondary.id })
        mergedAwayIds.push(secondary.id)
      }
    } finally {
      // Report whatever actually completed even if a later secondary in the batch failed —
      // otherwise an admin who merged 2 of 3 duplicates would see only an error toast and have
      // no idea 2 of them actually went through.
      if (mergedAwayIds.length > 0) {
        toast.success(t("mergeSuccess", { count: mergedAwayIds.length }))
        onMerged?.(mergedAwayIds, primaryTier.id)
      }
    }
    setConfirmOpen(false)
    backToList()
  }

  return (
    <>
      <Modal
        open={open && !confirmOpen}
        onOpenChange={onOpenChange}
        title={selectedGroup ? t("groupTitle", { label: primaryTier?.label ?? "" }) : t("title")}
        description={selectedGroup ? undefined : t("description")}
        size="lg"
      >
        {isLoading ? (
          <div className="space-y-2 py-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : isError ? (
          <p className="py-6 text-sm text-destructive">{t("loadError")}</p>
        ) : !selectedGroup ? (
          <GroupList groups={groups ?? []} onSelect={openGroup} emptyLabel={t("empty")} t={t} />
        ) : (
          <div className="space-y-4 py-2">
            <Button variant="ghost" size="sm" onClick={backToList} className="-ml-2 text-muted-foreground">
              <CaretLeftIcon className="mr-1 size-3.5" />
              {t("backAction")}
            </Button>

            <div className="space-y-2">
              <p className="text-sm font-medium">{t("keepAsPrimary")}</p>
              <div className="divide-y divide-border rounded-lg border">
                {selectedGroup.tiers.map(tier => (
                  <label key={tier.id} className="flex items-start gap-3 px-3 py-2.5">
                    <input
                      type="radio"
                      name="primary-tier"
                      className="mt-1 accent-primary"
                      checked={primaryTierId === tier.id}
                      onChange={() => selectPrimary(tier.id)}
                    />
                    <TierSummary tier={tier} t={t} />
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-sm font-medium">{t("mergeIntoPrimary")}</p>
              <div className="divide-y divide-border rounded-lg border">
                {selectedGroup.tiers.filter(tier => tier.id !== primaryTierId).map(tier => (
                  <div key={tier.id} className="px-3 py-2.5">
                    <CheckboxField
                      label={<TierSummary tier={tier} t={t} />}
                      checked={secondaryIds.has(tier.id)}
                      onChange={e => toggleSecondary(tier.id, e.target.checked)}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t pt-4">
              <Button variant="outline" onClick={backToList}>{t("cancelAction")}</Button>
              <Button onClick={() => setConfirmOpen(true)} disabled={secondaryTiers.length === 0}>
                {t("mergeAction")}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {primaryTier && (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title={t("confirmTitle")}
          description={
            t("confirmDescription", {
              count:           secondaryTiers.length,
              primaryLabel:    primaryTier.label,
              cotisationCount: totals.cotisationCount,
              membreCount:     totals.membreCount,
            }) +
            (totals.activeSubscriptionCount > 0
              ? " " + t("activeSubscriptionWarning", { count: totals.activeSubscriptionCount })
              : "")
          }
          confirmLabel={t("mergeAction")}
          confirmVariant="default"
          loading={merge.isPending}
          onConfirm={handleConfirmMerge}
        />
      )}
    </>
  )
}

function TierSummary({ tier, t }: { tier: DuplicateTierCandidate; t: ReturnType<typeof useTranslations> }) {
  return (
    <span className="space-y-0.5">
      <span className="block text-sm font-medium">{tier.label}</span>
      <span className="block text-xs text-muted-foreground">
        {tier.formTitle} · {priceLabel(tier, t)} · {t("tierCounts", { cotisationCount: tier.cotisationCount, membreCount: tier.membreCount })}
      </span>
      {tier.activeSubscriptionCount > 0 && (
        <span className="flex items-center gap-1 text-xs text-warning">
          <WarningIcon className="size-3.5 shrink-0" />
          {t("activeSubscriptionWarning", { count: tier.activeSubscriptionCount })}
        </span>
      )}
    </span>
  )
}

function GroupList({ groups, onSelect, emptyLabel, t }: {
  groups:     DuplicateTierGroup[]
  onSelect:   (group: DuplicateTierGroup) => void
  emptyLabel: string
  t:          ReturnType<typeof useTranslations>
}) {
  if (groups.length === 0) return <p className="py-6 text-sm text-muted-foreground">{emptyLabel}</p>

  return (
    <div className="divide-y divide-border rounded-lg border">
      {groups.map(group => {
        // Representative label for the heading: the most-used tier, not just array/insertion
        // order — otherwise a stray "adhésion   standard" could outrank the clean "Adhésion
        // Standard" just because it happens to come first in the query result.
        const representative = [...group.tiers].sort((a, b) => b.cotisationCount - a.cotisationCount)[0]
        return (
          <button
            key={group.normalizedLabel}
            type="button"
            onClick={() => onSelect(group)}
            className="flex w-full flex-col gap-1 px-3 py-3 text-left hover:bg-muted/50"
          >
            <span className="text-sm font-medium">
              {t("groupSummary", { count: group.tiers.length, label: representative.label })}
            </span>
            <span className="text-xs text-muted-foreground">
              {group.tiers.map(tier => tier.label).join(" · ")}
            </span>
          </button>
        )
      })}
    </div>
  )
}
