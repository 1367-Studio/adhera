"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { PlusIcon, TrashIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr";
import { Modal } from "@/components/ui/modal"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { Button } from "@/components/ui/button"
import { useCreateRule } from "@/hooks/use-automation-rules"
import { useMessageTemplates } from "@/hooks/use-message-templates"
import { useMembreTypes } from "@/hooks/use-membre-types"

type Translator = ReturnType<typeof useTranslations>
type StepType = "before" | "after"

interface Step {
  key:  number
  type: StepType
  days: number
}

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
}

function getTypeOptions(t: Translator) {
  return [
    { value: "before", label: t("messages.campagneModal.stepTypeBefore") },
    { value: "after",  label: t("messages.campagneModal.stepTypeAfter") },
  ]
}

const DEFAULT_STEPS: Step[] = [
  { key: 0, type: "before", days: 30 },
  { key: 1, type: "before", days: 7 },
  { key: 2, type: "after",  days: 15 },
]

export function CampagneModal({ open, onOpenChange }: Props) {
  const t = useTranslations()
  const TYPE_OPTIONS = getTypeOptions(t)
  const createRule = useCreateRule()
  const { data: templates = [] } = useMessageTemplates()
  const { data: membreTypes = [] } = useMembreTypes()

  const currentYear = new Date().getFullYear()

  const [name,       setName]       = useState("")
  const [templateId, setTemplateId] = useState("")
  const [recipients, setRecipients] = useState("ALL")
  const [year,       setYear]       = useState(String(currentYear))
  const [dueDate,    setDueDate]    = useState("")
  const [cooldown,   setCooldown]   = useState("7")
  const [steps,      setSteps]      = useState<Step[]>(DEFAULT_STEPS)
  const [loading,    setLoading]    = useState(false)
  const [nextKey,    setNextKey]    = useState(DEFAULT_STEPS.length)

  function addStep() {
    setSteps(s => [...s, { key: nextKey, type: "before", days: 7 }])
    setNextKey(k => k + 1)
  }

  function removeStep(key: number) {
    setSteps(s => s.filter(st => st.key !== key))
  }

  function updateStep(key: number, field: keyof Omit<Step, "key">, value: string | number) {
    setSteps(s => s.map(st => st.key === key ? { ...st, [field]: value } : st))
  }

  function reset() {
    setName(""); setTemplateId(""); setRecipients("ALL")
    setYear(String(currentYear)); setDueDate(""); setCooldown("7")
    setSteps(DEFAULT_STEPS)
    setNextKey(DEFAULT_STEPS.length)
  }

  function validate(): string | null {
    if (!name.trim())       return t("messages.campagneModal.validation.nameRequired")
    if (!templateId)        return t("messages.campagneModal.validation.templateRequired")
    if (steps.length === 0) return t("messages.campagneModal.validation.stepsRequired")

    const yearNum = Number(year)
    if (!year || isNaN(yearNum) || yearNum < currentYear) {
      return t("messages.campagneModal.validation.yearMin", { year: currentYear })
    }

    for (const step of steps) {
      if (!step.days || step.days < 1) return t("messages.campagneModal.validation.stepDaysMin")
    }

    const keys = steps.map(s => `${s.type}:${s.days}`)
    const unique = new Set(keys)
    if (unique.size !== keys.length) return t("messages.campagneModal.validation.duplicateSteps")

    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const error = validate()
    if (error) { toast.error(error); return }

    setLoading(true)
    const created: string[] = []
    const failed:  string[] = []

    for (const step of steps) {
      const label = step.type === "before" ? `J-${step.days}` : `J+${step.days}`
      try {
        await createRule.mutateAsync({
          name:          `${name} — ${label}`,
          templateId,
          triggerType:   step.type === "before" ? "EVENT_COTISATION_DUE" : "EVENT_PAYMENT_OVERDUE",
          channel:       "EMAIL",
          recipients,
          triggerConfig: step.type === "before"
            ? { daysBefore: step.days, dueDate: dueDate || undefined, year: Number(year), cooldownDays: Number(cooldown) }
            : { daysAfter:  step.days, year: Number(year), cooldownDays: Number(cooldown) },
        })
        created.push(label)
      } catch {
        failed.push(label)
      }
    }

    setLoading(false)

    if (failed.length === 0) {
      toast.success(t("messages.campagneModal.toasts.created", { count: created.length }))
      reset()
      onOpenChange(false)
    } else if (created.length === 0) {
      toast.error(t("messages.campagneModal.toasts.allFailed"))
    } else {
      toast.warning(t("messages.campagneModal.toasts.partial", {
        createdCount: created.length,
        failedCount:  failed.length,
        names:        failed.join(", "),
      }))
      reset()
      onOpenChange(false)
    }
  }

  const templateOptions  = templates.map(tpl => ({ value: tpl.id, label: tpl.name }))
  const recipientOptions = [
    { value: "ALL", label: t("messages.campagneModal.recipientsAll") },
    ...membreTypes.map(mt => ({ value: `TYPE:${mt.id}`, label: t("messages.campagneModal.recipientsType", { name: mt.name }) })),
  ]
  const noTemplates = templates.length === 0

  return (
    <Modal
      open={open}
      onOpenChange={open => { if (!open) reset(); onOpenChange(open) }}
      title={t("messages.campagneModal.title")}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <p className="text-sm text-muted-foreground">
          {t("messages.campagneModal.description")}
        </p>

        {noTemplates && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-300">
            <WarningCircleIcon className="size-4 shrink-0 mt-0.5" />
            <span>
              {t("messages.campagneModal.noTemplatesWarningPrefix")}
              <strong>{t("messages.view.tabs.templates")}</strong>
              {t("messages.campagneModal.noTemplatesWarningSuffix")}
            </span>
          </div>
        )}

        <FormField
          label={t("messages.campagneModal.campaignName")}
          required
          placeholder={t("messages.campagneModal.campaignNamePlaceholder")}
          value={name}
          onChange={e => setName(e.target.value)}
        />

        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label={t("messages.campagneModal.templateLabel")}
            required
            options={templateOptions}
            value={templateId}
            onValueChange={setTemplateId}
            placeholder={t("messages.campagneModal.templatePlaceholder")}
            disabled={noTemplates}
          />
          <SelectField
            label={t("messages.campagneModal.recipients")}
            options={recipientOptions}
            value={recipients}
            onValueChange={setRecipients}
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <FormField
            label={t("messages.campagneModal.cotisationYear")}
            type="number"
            placeholder={String(new Date().getFullYear())}
            min={new Date().getFullYear()}
            value={year}
            onChange={e => setYear(e.target.value)}
          />
          <FormField
            label={t("messages.campagneModal.dueDate")}
            type="date"
            hint={t("messages.campagneModal.dueDateHint")}
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
          />
          <FormField
            label={t("messages.campagneModal.cooldownDays")}
            type="number"
            min={1}
            placeholder="7"
            hint={t("messages.campagneModal.cooldownHint")}
            value={cooldown}
            onChange={e => setCooldown(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{t("messages.campagneModal.stepsTitle")}</p>
            <Button type="button" variant="outline" size="sm" onClick={addStep}>
              <PlusIcon className="mr-1.5 size-3.5" /> {t("messages.campagneModal.addStep")}
            </Button>
          </div>

          {steps.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3 text-center border border-dashed rounded-lg">
              {t("messages.campagneModal.noSteps")}
            </p>
          ) : (
            <div className="space-y-2">
              {steps.map((step, i) => (
                <div key={step.key} className="flex items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2">
                  <span className="text-xs text-muted-foreground w-5 shrink-0">{i + 1}.</span>
                  <input
                    type="number"
                    min={1}
                    value={step.days}
                    onChange={e => {
                      const v = Math.max(1, Number(e.target.value) || 1)
                      updateStep(step.key, "days", v)
                    }}
                    className="w-16 rounded border bg-background px-2 py-1 text-sm text-center"
                  />
                  <div className="flex-1">
                    <SelectField
                      label=""
                      options={TYPE_OPTIONS}
                      value={step.type}
                      onValueChange={v => updateStep(step.key, "type", v)}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeStep(step.key)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <TrashIcon className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>{t("common.cancel")}</Button>
          <Button type="submit" loading={loading} disabled={noTemplates || steps.length === 0}>
            {steps.length > 0
              ? t("messages.campagneModal.createWithCount", { count: steps.length })
              : t("messages.campagneModal.create")
            }
          </Button>
        </div>
      </form>
    </Modal>
  )
}
