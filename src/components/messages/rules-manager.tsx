"use client"

import { useState } from "react"
import { toast } from "sonner"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { useTranslations } from "next-intl"
import { PlusIcon, PencilSimpleIcon, TrashIcon, RobotIcon, PauseCircleIcon, PlayCircleIcon, ClockIcon } from "@phosphor-icons/react/dist/ssr";
import {
  useAutomationRules, useDeleteRule, useToggleRuleStatus,
  type AutomationRule,
} from "@/hooks/use-automation-rules"
import { RuleModal } from "@/components/messages/rule-modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type Translator = ReturnType<typeof useTranslations>

function getTriggerLabels(t: Translator): Record<string, string> {
  return {
    SCHEDULED_ONCE:        t("messages.rulesManager.triggerLabels.scheduledOnce"),
    SCHEDULED_RECURRING:   t("messages.rulesManager.triggerLabels.scheduledRecurring"),
    EVENT_COTISATION_DUE:  t("messages.rulesManager.triggerLabels.eventCotisationDue"),
    EVENT_PAYMENT_OVERDUE: t("messages.rulesManager.triggerLabels.eventPaymentOverdue"),
    EVENT_REMINDER:        t("messages.rulesManager.triggerLabels.eventReminder"),
    RSVP_CONFIRMED:        t("messages.rulesManager.triggerLabels.rsvpConfirmed"),
    MEMBER_CREATED:        t("messages.rulesManager.triggerLabels.memberCreated"),
    MEMBER_BIRTHDAY:       t("messages.rulesManager.triggerLabels.memberBirthday"),
    EVENT_ADHERENT_LAPSED: t("messages.rulesManager.triggerLabels.eventAdherentLapsed"),
  }
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  PAUSED: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  DONE:   "bg-muted text-muted-foreground",
}

function getStatusLabels(t: Translator): Record<string, string> {
  return {
    ACTIVE: t("messages.rulesManager.statusLabels.active"),
    PAUSED: t("messages.rulesManager.statusLabels.paused"),
    DONE:   t("messages.rulesManager.statusLabels.done"),
  }
}

function triggerSummary(rule: AutomationRule, t: Translator): string {
  const c = rule.triggerConfig
  if (rule.triggerType === "SCHEDULED_ONCE") {
    if (!c.date) return t("messages.rulesManager.triggerSummary.dateNotSet")
    const d = format(new Date(c.date as string), "d MMM yyyy", { locale: fr })
    return t("messages.rulesManager.triggerSummary.onDate", { date: d, time: (c.time as string) ?? "09:00" })
  }
  if (rule.triggerType === "SCHEDULED_RECURRING") {
    const freq: Record<string, string> = {
      daily:   t("messages.rulesManager.triggerSummary.frequency.daily"),
      weekly:  t("messages.rulesManager.triggerSummary.frequency.weekly"),
      monthly: t("messages.rulesManager.triggerSummary.frequency.monthly"),
    }
    const label = freq[c.frequency as string] ?? ""
    const time  = (c.time as string) ?? "09:00"
    if (c.frequency === "weekly" && c.dayOfWeek != null) {
      const days = [
        t("messages.rulesManager.triggerSummary.weekdaysShort.sunday"),
        t("messages.rulesManager.triggerSummary.weekdaysShort.monday"),
        t("messages.rulesManager.triggerSummary.weekdaysShort.tuesday"),
        t("messages.rulesManager.triggerSummary.weekdaysShort.wednesday"),
        t("messages.rulesManager.triggerSummary.weekdaysShort.thursday"),
        t("messages.rulesManager.triggerSummary.weekdaysShort.friday"),
        t("messages.rulesManager.triggerSummary.weekdaysShort.saturday"),
      ]
      return t("messages.rulesManager.triggerSummary.weeklyOn", { label, day: days[c.dayOfWeek as number], time })
    }
    if (c.frequency === "monthly" && c.dayOfMonth != null) {
      return t("messages.rulesManager.triggerSummary.monthlyOn", { label, day: c.dayOfMonth as number, time })
    }
    return t("messages.rulesManager.triggerSummary.atTime", { label, time })
  }
  if (rule.triggerType === "EVENT_COTISATION_DUE") {
    return t("messages.rulesManager.triggerSummary.cotisationDue", { days: (c.daysBefore as number) ?? 30, year: (c.year as number) ?? "" })
  }
  if (rule.triggerType === "EVENT_PAYMENT_OVERDUE") {
    return t("messages.rulesManager.triggerSummary.paymentOverdue", { days: (c.daysAfter as number) ?? 30, year: (c.year as number) ?? "" })
  }
  if (rule.triggerType === "EVENT_REMINDER") {
    const d = (c.daysBefore as number) ?? 1
    return d === 1
      ? t("messages.rulesManager.triggerSummary.reminderTomorrow")
      : t("messages.rulesManager.triggerSummary.reminderDays", { days: d })
  }
  if (rule.triggerType === "RSVP_CONFIRMED") return t("messages.rulesManager.triggerSummary.rsvpConfirmed")
  if (rule.triggerType === "MEMBER_CREATED")  return t("messages.rulesManager.triggerSummary.memberCreated")
  if (rule.triggerType === "MEMBER_BIRTHDAY") return t("messages.rulesManager.triggerSummary.memberBirthday")
  return ""
}

export function RulesManager() {
  const t = useTranslations()
  const triggerLabels = getTriggerLabels(t)
  const statusLabels  = getStatusLabels(t)
  const { data: rules = [], isLoading } = useAutomationRules()
  const deleteMut = useDeleteRule()
  const toggleMut = useToggleRuleStatus()

  const [modalOpen,    setModalOpen]    = useState(false)
  const [editTarget,   setEditTarget]   = useState<AutomationRule | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AutomationRule | null>(null)

  function openCreate() { setEditTarget(null); setModalOpen(true) }
  function openEdit(r: AutomationRule) { setEditTarget(r); setModalOpen(true) }

  async function handleToggle(rule: AutomationRule) {
    if (rule.status === "DONE") return
    const next = rule.status === "ACTIVE" ? "PAUSED" : "ACTIVE"
    try {
      await toggleMut.mutateAsync({ id: rule.id, status: next })
      toast.success(next === "ACTIVE" ? t("messages.rulesManager.toasts.activated") : t("messages.rulesManager.toasts.paused"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMut.mutateAsync(deleteTarget.id)
      toast.success(t("messages.rulesManager.toasts.deleted", { name: deleteTarget.name }))
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">{t("messages.rulesManager.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("messages.rulesManager.subtitle")}</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <PlusIcon className="mr-1.5 size-4" /> {t("messages.rulesManager.newRule")}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0,1,2].map(i => <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : rules.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-12 text-center">
          <RobotIcon className="size-8 text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium">{t("messages.rulesManager.noRules")}</p>
            <p className="text-xs text-muted-foreground">{t("messages.rulesManager.noRulesHint")}</p>
          </div>
          <Button size="sm" variant="outline" onClick={openCreate}>
            <PlusIcon className="mr-1.5 size-3.5" /> {t("messages.rulesManager.createRule")}
          </Button>
        </div>
      ) : (
        <div className="divide-y rounded-xl border overflow-hidden">
          {rules.map(r => (
            <div key={r.id} className="flex items-start gap-4 px-4 py-3 bg-card hover:bg-muted/30 transition-colors">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="font-medium text-sm">{r.name}</p>
                  <span className={cn("text-[10px] font-semibold px-2 py-0.5 rounded-full", STATUS_COLORS[r.status])}>
                    {statusLabels[r.status]}
                  </span>
                  <span className="text-[10px] text-muted-foreground border rounded-full px-2 py-0.5">
                    {triggerLabels[r.triggerType]}
                  </span>
                  {r.status === "ACTIVE" && !r.template.active && (
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                      title={t("messages.rulesManager.inactiveTemplateTooltip")}
                    >
                      {t("messages.rulesManager.inactiveTemplateBadge")}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {triggerSummary(r, t)}
                  {t("messages.rulesManager.templateSuffix", { name: r.template.name })}
                </p>
                {r.nextRunAt && r.status === "ACTIVE" && (() => {
                  const next = new Date(r.nextRunAt)
                  const isPast = next < new Date()
                  return (
                    <p className="text-[11px] text-muted-foreground/60 flex items-center gap-1">
                      <ClockIcon className="size-2.5" />
                      {isPast
                        ? t("messages.rulesManager.pendingExecution")
                        : t("messages.rulesManager.nextRun", { date: format(next, "d MMM yyyy 'à' HH'h'mm", { locale: fr }) })
                      }
                    </p>
                  )
                })()}
                {r.lastRunAt && (
                  <p className="text-[11px] text-muted-foreground/60">
                    {t("messages.rulesManager.lastRun", { date: format(new Date(r.lastRunAt), "d MMM yyyy", { locale: fr }) })}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 pt-0.5">
                {r.status !== "DONE" && (
                  <button
                    type="button"
                    onClick={() => handleToggle(r)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title={r.status === "ACTIVE" ? t("messages.rulesManager.actions.pause") : t("messages.rulesManager.actions.activate")}
                    disabled={toggleMut.isPending}
                  >
                    {r.status === "ACTIVE"
                      ? <PauseCircleIcon className="size-3.5" />
                      : <PlayCircleIcon  className="size-3.5" />
                    }
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => openEdit(r)}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title={t("messages.rulesManager.actions.edit")}
                >
                  <PencilSimpleIcon className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(r)}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                  title={t("messages.rulesManager.actions.delete")}
                >
                  <TrashIcon className="size-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <RuleModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        rule={editTarget}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={open => !open && setDeleteTarget(null)}
        title={t("messages.rulesManager.deleteConfirmTitle", { name: deleteTarget?.name ?? "" })}
        description={t("messages.rulesManager.deleteConfirmDescription")}
        confirmLabel={t("messages.rulesManager.actions.delete")}
        loading={deleteMut.isPending}
        onConfirm={handleDelete}
      />
    </div>
  )
}
