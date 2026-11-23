"use client"

import { useState } from "react"
import Link from "next/link"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import {
  BellIcon, UserPlusIcon, ReceiptIcon, PackageIcon, BankIcon, ShoppingCartIcon, InvoiceIcon,
} from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"
import { RowActions } from "@/components/ui/row-actions"
import { DateField, toValue } from "@/components/ui/date-field"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog"
import type { DashboardActionRow, DashboardActionIconKey } from "@/lib/dashboard-actions"

type SnoozedRow = DashboardActionRow & { snoozedUntil: string }

// Row icons travel from the server as a plain string key (see DashboardActionIconKey) — a
// component reference can't survive NextResponse.json() — and get mapped back to the real
// icon here, client-side only.
const ICONS: Record<DashboardActionIconKey, typeof BellIcon> = {
  bell:            BellIcon,
  "user-plus":     UserPlusIcon,
  receipt:         ReceiptIcon,
  package:         PackageIcon,
  bank:            BankIcon,
  "shopping-cart": ShoppingCartIcon,
  invoice:         InvoiceIcon,
}

function fmt(n: number) {
  return n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
}

// snoozedUntil is stored as UTC midnight of a calendar day (see the snooze route) — reading
// it back through date-fns' format() directly would re-interpret that instant in the
// browser's own timezone, silently turning "25 nov." into "24 nov." for anyone west of UTC.
// Reading the UTC getters and rebuilding a local Date from them keeps the calendar day
// intact, same convention as DateField's own parseValue()/toValue().
function formatSnoozedDate(iso: string): string {
  const stored = new Date(iso)
  const calendarDay = new Date(stored.getUTCFullYear(), stored.getUTCMonth(), stored.getUTCDate())
  return format(calendarDay, "d MMM yyyy", { locale: fr })
}

// "Reporter jusqu'à aujourd'hui" is a no-op nobody means to pick — the earliest date that
// actually postpones anything is tomorrow.
function minSnoozeDate(): string {
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  return toValue(tomorrow)
}

interface Props {
  rows:        DashboardActionRow[]
  snoozedRows: SnoozedRow[]
  isLoading:   boolean
  isError:     boolean
}

export function ActionsTodoPanel({ rows, snoozedRows, isLoading, isError }: Props) {
  const t       = useTranslations("dashboard.actionsTodo")
  const tCommon = useTranslations("common")
  const qc      = useQueryClient()

  const [snoozeTarget, setSnoozeTarget] = useState<DashboardActionRow | null>(null)
  const [snoozeUntil, setSnoozeUntil]   = useState("")
  const [saving, setSaving]             = useState(false)
  // Tracks which already-snoozed row's "Annuler" is in flight, so only that row's button
  // shows a spinner instead of the whole panel.
  const [cancelingKey, setCancelingKey] = useState<string | null>(null)

  function openSnooze(row: DashboardActionRow) {
    setSnoozeTarget(row)
    setSnoozeUntil("")
  }

  async function postSnooze(actionKey: string, until: string | null) {
    const res = await fetch("/api/dashboard/actions/snooze", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ actionKey, until }),
    })
    if (!res.ok) throw new Error()
    await qc.invalidateQueries({ queryKey: ["dashboard-actions"] })
  }

  async function confirmSnooze() {
    if (!snoozeTarget || !snoozeUntil) return
    setSaving(true)
    try {
      await postSnooze(snoozeTarget.key, snoozeUntil)
      setSnoozeTarget(null)
    } catch {
      toast.error(tCommon("networkError"))
    } finally {
      setSaving(false)
    }
  }

  async function cancelSnooze(actionKey: string) {
    setCancelingKey(actionKey)
    try {
      await postSnooze(actionKey, null)
    } catch {
      toast.error(tCommon("networkError"))
    } finally {
      setCancelingKey(null)
    }
  }

  return (
    <div className="border-b pb-4 mb-2">
      {isLoading ? (
        // Without this, clicking the trigger before the first fetch resolves opens a panel
        // with nothing in it at all — reads as broken rather than "loading".
        <div className="space-y-2 py-2">
          {[0, 1].map(i => (
            <div key={i} className="h-5 w-2/3 animate-pulse rounded bg-muted" />
          ))}
        </div>
      ) : isError ? (
        // Distinct from the empty state on purpose — "tout est à jour" on a request that
        // actually failed (e.g. a permission error) would tell the wrong story.
        <p className="py-2 text-sm text-destructive">{t("loadError")}</p>
      ) : rows.length === 0 && snoozedRows.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        // max-h + scroll: with up to 7 categories plus a snoozed section, the list can
        // outgrow the panel's comfortable height — scroll it instead of pushing the whole
        // page down (FORM-119 follow-up from Emmanuelle).
        <div className="max-h-[28rem] space-y-1 overflow-y-auto">
          {rows.map(row => {
            const RowIcon = ICONS[row.icon]
            return (
              <div key={row.key} className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <RowIcon className="size-4 shrink-0 text-muted-foreground" />
                  <p className="min-w-0 truncate text-sm">
                    {t(`rows.${row.key}`, { count: row.count })}
                    {row.amount != null && <span className="text-muted-foreground"> · {fmt(row.amount)}</span>}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button variant="outline" size="sm" nativeButton={false} render={<Link href={row.href} />}>
                    {t(`actionLabels.${row.actionLabel}`)}
                  </Button>
                  <RowActions actions={[{ label: t("snooze"), onClick: () => openSnooze(row) }]} />
                </div>
              </div>
            )
          })}

          {snoozedRows.length > 0 && (
            <div className="mt-1 space-y-2 border-t pt-2">
              <p className="text-xs text-muted-foreground">{t("snoozedSectionTitle", { count: snoozedRows.length })}</p>
              {snoozedRows.map(row => {
                const RowIcon = ICONS[row.icon]
                return (
                  <div key={row.key} className="flex flex-col gap-2 py-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <RowIcon className="size-4 shrink-0 text-muted-foreground/60" />
                      <p className="min-w-0 truncate text-sm text-muted-foreground">
                        {t(`rows.${row.key}`, { count: row.count })}
                        <span> · {t("snoozedUntil", { date: formatSnoozedDate(row.snoozedUntil) })}</span>
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="shrink-0"
                      loading={cancelingKey === row.key}
                      onClick={() => cancelSnooze(row.key)}
                    >
                      {t("cancelSnooze")}
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      <Dialog open={!!snoozeTarget} onOpenChange={open => !open && setSnoozeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("snoozeDialogTitle")}</DialogTitle>
            <DialogDescription>{t("snoozeDialogDescription")}</DialogDescription>
          </DialogHeader>
          <DateField
            label={t("snoozeUntilLabel")}
            value={snoozeUntil}
            onChange={setSnoozeUntil}
            min={minSnoozeDate()}
            allowFuture
            required
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setSnoozeTarget(null)}>
              {tCommon("cancel")}
            </Button>
            <Button onClick={confirmSnooze} disabled={!snoozeUntil} loading={saving}>
              {t("confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
