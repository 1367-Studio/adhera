"use client"

import { useState } from "react"
import { toast } from "sonner"
import { PlusIcon, Trash2Icon, AlertCircleIcon } from "lucide-react"
import { Modal } from "@/components/ui/modal"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { Button } from "@/components/ui/button"
import { useCreateRule } from "@/hooks/use-automation-rules"
import { useMessageTemplates } from "@/hooks/use-message-templates"
import { useMembreTypes } from "@/hooks/use-membre-types"

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

const TYPE_OPTIONS = [
  { value: "before", label: "jours avant l'échéance" },
  { value: "after",  label: "jours après l'échéance" },
]

const DEFAULT_STEPS: Step[] = [
  { key: 0, type: "before", days: 30 },
  { key: 1, type: "before", days: 7 },
  { key: 2, type: "after",  days: 15 },
]

export function CampagneModal({ open, onOpenChange }: Props) {
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
    if (!name.trim())       return "Nom de la campagne requis"
    if (!templateId)        return "Modèle requis"
    if (steps.length === 0) return "Ajoutez au moins une étape"

    const yearNum = Number(year)
    if (!year || isNaN(yearNum) || yearNum < currentYear) {
      return `L'année doit être ${currentYear} ou plus`
    }

    for (const step of steps) {
      if (!step.days || step.days < 1) return "Chaque étape doit avoir au moins 1 jour"
    }

    const keys = steps.map(s => `${s.type}:${s.days}`)
    const unique = new Set(keys)
    if (unique.size !== keys.length) return "Des étapes en double ont été détectées"

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
      toast.success(`Campagne créée avec ${created.length} règle${created.length > 1 ? "s" : ""}`)
      reset()
      onOpenChange(false)
    } else if (created.length === 0) {
      toast.error("Aucune règle n'a pu être créée")
    } else {
      toast.warning(`${created.length} règle${created.length > 1 ? "s" : ""} créée${created.length > 1 ? "s" : ""}, ${failed.length} échoué${failed.length > 1 ? "es" : "e"} : ${failed.join(", ")}`)
      reset()
      onOpenChange(false)
    }
  }

  const templateOptions  = templates.map(t => ({ value: t.id, label: t.name }))
  const recipientOptions = [
    { value: "ALL", label: "Tous les membres actifs" },
    ...membreTypes.map(t => ({ value: `TYPE:${t.id}`, label: `Type : ${t.name}` })),
  ]
  const noTemplates = templates.length === 0

  return (
    <Modal
      open={open}
      onOpenChange={open => { if (!open) reset(); onOpenChange(open) }}
      title="Séquence de relances"
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        <p className="text-sm text-muted-foreground">
          Créez une séquence de rappels de cotisation. Chaque étape devient une règle distincte déclenchée automatiquement.
        </p>

        {noTemplates && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-300">
            <AlertCircleIcon className="size-4 shrink-0 mt-0.5" />
            <span>Aucun modèle disponible. Créez d'abord un modèle dans l'onglet <strong>Modèles</strong>.</span>
          </div>
        )}

        <FormField
          label="Nom de la campagne"
          required
          placeholder="Relances cotisation 2026"
          value={name}
          onChange={e => setName(e.target.value)}
        />

        <div className="grid grid-cols-2 gap-3">
          <SelectField
            label="Modèle de message"
            required
            options={templateOptions}
            value={templateId}
            onValueChange={setTemplateId}
            placeholder="Choisir un modèle…"
            disabled={noTemplates}
          />
          <SelectField
            label="Destinataires"
            options={recipientOptions}
            value={recipients}
            onValueChange={setRecipients}
          />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <FormField
            label="Année de cotisation"
            type="number"
            placeholder={String(new Date().getFullYear())}
            min={new Date().getFullYear()}
            value={year}
            onChange={e => setYear(e.target.value)}
          />
          <FormField
            label="Date d'échéance"
            type="date"
            hint="Pour les étapes 'avant'. Optionnel — défaut: 31 déc."
            value={dueDate}
            onChange={e => setDueDate(e.target.value)}
          />
          <FormField
            label="Cooldown (jours)"
            type="number"
            min={1}
            placeholder="7"
            hint="Délai min. entre 2 envois au même membre"
            value={cooldown}
            onChange={e => setCooldown(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Étapes de la séquence</p>
            <Button type="button" variant="outline" size="sm" onClick={addStep}>
              <PlusIcon className="mr-1.5 size-3.5" /> Ajouter une étape
            </Button>
          </div>

          {steps.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3 text-center border border-dashed rounded-lg">
              Aucune étape — ajoutez-en au moins une.
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
                    <Trash2Icon className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>Annuler</Button>
          <Button type="submit" loading={loading} disabled={noTemplates || steps.length === 0}>
            Créer {steps.length > 0 ? `(${steps.length} règle${steps.length > 1 ? "s" : ""})` : ""}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
