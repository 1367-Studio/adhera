"use client"

import { useState } from "react"
import { toast } from "sonner"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { PlusIcon, PencilIcon, Trash2Icon, BotIcon, PauseCircleIcon, PlayCircleIcon, ClockIcon } from "lucide-react"
import {
  useAutomationRules, useDeleteRule, useToggleRuleStatus,
  type AutomationRule,
} from "@/hooks/use-automation-rules"
import { RuleModal } from "@/components/messages/rule-modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const TRIGGER_LABELS: Record<string, string> = {
  SCHEDULED_ONCE:        "Date unique",
  SCHEDULED_RECURRING:   "Récurrent",
  EVENT_COTISATION_DUE:  "Cotisation à venir",
  EVENT_PAYMENT_OVERDUE: "Paiement en retard",
  EVENT_REMINDER:        "Rappel d'événement",
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  PAUSED: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  DONE:   "bg-muted text-muted-foreground",
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Active",
  PAUSED: "Pausée",
  DONE:   "Terminée",
}

function triggerSummary(rule: AutomationRule): string {
  const c = rule.triggerConfig
  if (rule.triggerType === "SCHEDULED_ONCE") {
    if (!c.date) return "Date non définie"
    const d = format(new Date(c.date as string), "d MMM yyyy", { locale: fr })
    return `Le ${d} à ${(c.time as string) ?? "09:00"}`
  }
  if (rule.triggerType === "SCHEDULED_RECURRING") {
    const freq: Record<string, string> = { daily: "Quotidien", weekly: "Hebdomadaire", monthly: "Mensuel" }
    const label = freq[c.frequency as string] ?? ""
    if (c.frequency === "weekly" && c.dayOfWeek != null) {
      const days = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"]
      return `${label} (${days[c.dayOfWeek as number]}) à ${(c.time as string) ?? "09:00"}`
    }
    if (c.frequency === "monthly" && c.dayOfMonth != null) {
      return `${label} (le ${c.dayOfMonth}) à ${(c.time as string) ?? "09:00"}`
    }
    return `${label} à ${(c.time as string) ?? "09:00"}`
  }
  if (rule.triggerType === "EVENT_COTISATION_DUE") {
    return `${c.daysBefore ?? 30}j avant échéance · année ${c.year ?? ""}`
  }
  if (rule.triggerType === "EVENT_PAYMENT_OVERDUE") {
    return `${c.daysAfter ?? 30}j de retard · année ${c.year ?? ""}`
  }
  if (rule.triggerType === "EVENT_REMINDER") {
    const d = c.daysBefore ?? 1
    return d === 1 ? "La veille de chaque événement" : `${d}j avant chaque événement`
  }
  return ""
}

export function RulesManager() {
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
      toast.success(next === "ACTIVE" ? "Règle activée" : "Règle mise en pause")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMut.mutateAsync(deleteTarget.id)
      toast.success(`Règle « ${deleteTarget.name} » supprimée`)
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Règles d'automatisation</h2>
          <p className="text-sm text-muted-foreground">Envois automatiques selon un calendrier ou un événement.</p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <PlusIcon className="mr-1.5 size-4" /> Nouvelle règle
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0,1,2].map(i => <div key={i} className="h-20 rounded-xl bg-muted animate-pulse" />)}
        </div>
      ) : rules.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-12 text-center">
          <BotIcon className="size-8 text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium">Aucune règle</p>
            <p className="text-xs text-muted-foreground">Créez une première règle pour automatiser vos envois.</p>
          </div>
          <Button size="sm" variant="outline" onClick={openCreate}>
            <PlusIcon className="mr-1.5 size-3.5" /> Créer une règle
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
                    {STATUS_LABELS[r.status]}
                  </span>
                  <span className="text-[10px] text-muted-foreground border rounded-full px-2 py-0.5">
                    {TRIGGER_LABELS[r.triggerType]}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{triggerSummary(r)} · Modèle : {r.template.name}</p>
                {r.nextRunAt && r.status === "ACTIVE" && (() => {
                  const next = new Date(r.nextRunAt)
                  const isPast = next < new Date()
                  return (
                    <p className="text-[11px] text-muted-foreground/60 flex items-center gap-1">
                      <ClockIcon className="size-2.5" />
                      {isPast
                        ? "En attente d'exécution"
                        : `Prochain envoi : ${format(next, "d MMM yyyy 'à' HH'h'mm", { locale: fr })}`
                      }
                    </p>
                  )
                })()}
                {r.lastRunAt && (
                  <p className="text-[11px] text-muted-foreground/60">
                    Dernier envoi : {format(new Date(r.lastRunAt), "d MMM yyyy", { locale: fr })}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0 pt-0.5">
                {r.status !== "DONE" && (
                  <button
                    type="button"
                    onClick={() => handleToggle(r)}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title={r.status === "ACTIVE" ? "Mettre en pause" : "Activer"}
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
                  title="Modifier"
                >
                  <PencilIcon className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setDeleteTarget(r)}
                  className="text-muted-foreground hover:text-destructive transition-colors"
                  title="Supprimer"
                >
                  <Trash2Icon className="size-3.5" />
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
        title={`Supprimer « ${deleteTarget?.name} » ?`}
        description="Cette règle sera supprimée définitivement. Les emails déjà envoyés ne sont pas affectés."
        confirmLabel="Supprimer"
        loading={deleteMut.isPending}
        onConfirm={handleDelete}
      />
    </div>
  )
}
