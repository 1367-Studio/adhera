"use client"

import { useEffect } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { WarningCircleIcon, WarningIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react/dist/ssr";
import { Modal } from "@/components/ui/modal"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { Button } from "@/components/ui/button"
import { useCreateRule, useUpdateRule, useTestSendRule, type AutomationRule, type RuleInput, type TriggerType, type MessageChannel } from "@/hooks/use-automation-rules"
import type { Resolver, SubmitHandler } from "react-hook-form"
import { useMessageTemplates } from "@/hooks/use-message-templates"
import { useMembreTypes } from "@/hooks/use-membre-types"
import { useModules } from "@/lib/user-context"

const EVENT_TRIGGERS: TriggerType[] = ["RSVP_CONFIRMED", "MEMBER_CREATED"]

const schema = z.object({
  name:          z.string().min(1, "Requis"),
  templateId:    z.string().min(1, "Requis"),
  triggerType:   z.enum(["SCHEDULED_ONCE", "SCHEDULED_RECURRING", "EVENT_COTISATION_DUE", "EVENT_PAYMENT_OVERDUE", "EVENT_REMINDER", "RSVP_CONFIRMED", "MEMBER_CREATED"]),
  channel:       z.enum(["EMAIL", "SMS", "BOTH"]).default("EMAIL"),
  recipients:    z.string(),
  // SCHEDULED_ONCE
  date:          z.string().optional(),
  time:          z.string().optional(),
  // SCHEDULED_RECURRING
  frequency:     z.enum(["daily", "weekly", "monthly"]).optional(),
  dayOfWeek:     z.string().optional(),
  dayOfMonth:    z.string().optional(),
  // EVENT_COTISATION_DUE
  daysBefore:    z.string().optional(),
  dueDate:       z.string().optional(),
  // EVENT_PAYMENT_OVERDUE
  daysAfter:     z.string().optional(),
  // shared event cotisation
  year:          z.string().optional(),
  cooldownDays:  z.string().optional(),
}).superRefine((v, ctx) => {
  if (v.triggerType === "SCHEDULED_ONCE" && !v.date) {
    ctx.addIssue({ code: "custom", path: ["date"], message: "Requis" })
  }
})

type FormValues = z.infer<typeof schema>

const TRIGGER_OPTIONS = [
  { value: "SCHEDULED_ONCE",        label: "Date unique" },
  { value: "SCHEDULED_RECURRING",   label: "Récurrent" },
  { value: "EVENT_COTISATION_DUE",  label: "Cotisation à venir" },
  { value: "EVENT_PAYMENT_OVERDUE", label: "Paiement en retard" },
  { value: "EVENT_REMINDER",        label: "Rappel d'événement" },
  { value: "RSVP_CONFIRMED",        label: "Confirmation de participation (RSVP)" },
  { value: "MEMBER_CREATED",        label: "Nouveau membre inscrit" },
]

const CHANNEL_OPTIONS = [
  { value: "EMAIL", label: "Email uniquement" },
  { value: "SMS",   label: "SMS uniquement" },
  { value: "BOTH",  label: "Email + SMS" },
]

const FREQUENCY_OPTIONS = [
  { value: "daily",   label: "Quotidien" },
  { value: "weekly",  label: "Hebdomadaire" },
  { value: "monthly", label: "Mensuel" },
]

const DAY_OF_WEEK_OPTIONS = [
  { value: "1", label: "Lundi" },
  { value: "2", label: "Mardi" },
  { value: "3", label: "Mercredi" },
  { value: "4", label: "Jeudi" },
  { value: "5", label: "Vendredi" },
  { value: "6", label: "Samedi" },
  { value: "0", label: "Dimanche" },
]

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
  rule?:        AutomationRule | null
}

export function RuleModal({ open, onOpenChange, rule }: Props) {
  const isEditing = !!rule
  const createMut    = useCreateRule()
  const updateMut    = useUpdateRule(rule?.id ?? "")
  const testMut      = useTestSendRule()
  const { messages, sms } = useModules()

  const { data: templates = [] } = useMessageTemplates()
  const { data: membreTypes = [] } = useMembreTypes()

  const defaultValues: FormValues = {
    name: "", templateId: "", triggerType: "SCHEDULED_ONCE", channel: "EMAIL",
    recipients: "ALL", time: "09:00", frequency: "monthly",
    dayOfMonth: "1", dayOfWeek: "1",
    daysBefore: "30", daysAfter: "30",
    year: new Date().getFullYear().toString(),
    cooldownDays: "7",
  }

  const { register, handleSubmit, reset, watch, control, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver:      zodResolver(schema) as Resolver<FormValues>,
    defaultValues,
  })

  const triggerType = watch("triggerType") as TriggerType
  const channel     = watch("channel") as MessageChannel
  const frequency   = watch("frequency")
  const templateId  = watch("templateId")

  const isEventTrigger       = EVENT_TRIGGERS.includes(triggerType)
  const selectedTemplate     = templates.find(t => t.id === templateId)
  const warnMissingSmsBody   = sms && channel !== "EMAIL" && !!templateId && !selectedTemplate?.smsBody

  useEffect(() => {
    if (!open) return
    if (rule) {
      const c = rule.triggerConfig
      reset({
        name:         rule.name,
        templateId:   rule.templateId,
        triggerType:  rule.triggerType,
        channel:      rule.channel ?? "EMAIL",
        recipients:   rule.recipients,
        date:         (c.date as string) ?? "",
        time:         (c.time as string) ?? "09:00",
        frequency:    (c.frequency as "daily" | "weekly" | "monthly") ?? "monthly",
        dayOfWeek:    c.dayOfWeek?.toString() ?? "1",
        dayOfMonth:   c.dayOfMonth?.toString() ?? "1",
        daysBefore:   c.daysBefore?.toString() ?? "30",
        dueDate:      (c.dueDate as string) ?? "",
        daysAfter:    c.daysAfter?.toString() ?? "30",
        year:         c.year?.toString() ?? new Date().getFullYear().toString(),
        cooldownDays: c.cooldownDays?.toString() ?? "7",
      })
    } else {
      reset(defaultValues)
    }
  }, [open, rule, reset])

  function buildTriggerConfig(values: FormValues): Record<string, unknown> {
    if (values.triggerType === "SCHEDULED_ONCE")      return { date: values.date, time: values.time }
    if (values.triggerType === "SCHEDULED_RECURRING") {
      const base: Record<string, unknown> = { frequency: values.frequency, time: values.time }
      if (values.frequency === "weekly")  base.dayOfWeek  = Number(values.dayOfWeek)
      if (values.frequency === "monthly") base.dayOfMonth = Number(values.dayOfMonth)
      return base
    }
    if (values.triggerType === "EVENT_COTISATION_DUE") {
      return { daysBefore: Number(values.daysBefore), dueDate: values.dueDate, year: Number(values.year), cooldownDays: Number(values.cooldownDays) }
    }
    if (values.triggerType === "EVENT_PAYMENT_OVERDUE") {
      return { daysAfter: Number(values.daysAfter), year: Number(values.year), cooldownDays: Number(values.cooldownDays) }
    }
    if (values.triggerType === "EVENT_REMINDER") {
      return { daysBefore: Number(values.daysBefore) }
    }
    return {}
  }

  async function onSubmit(values: FormValues) {
    const payload: RuleInput = {
      name:          values.name,
      templateId:    values.templateId,
      triggerType:   values.triggerType as TriggerType,
      triggerConfig: buildTriggerConfig(values),
      channel:       values.channel as MessageChannel,
      recipients:    isEventTrigger ? "ALL" : values.recipients,
    }
    try {
      if (isEditing) {
        await updateMut.mutateAsync(payload)
        toast.success("Règle mise à jour")
      } else {
        await createMut.mutateAsync(payload)
        toast.success("Règle créée")
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  const templateOptions = templates.map(t => ({
    value: t.id,
    label: t.name + (sms && t.smsBody ? " ✦" : ""),
  }))
  const recipientOptions = [
    { value: "ALL", label: "Tous les membres actifs" },
    ...membreTypes.map(t => ({ value: `TYPE:${t.id}`, label: `Type : ${t.name}` })),
  ]

  const isPending = isSubmitting || createMut.isPending || updateMut.isPending

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={isEditing ? "Modifier la règle" : "Nouvelle règle"}
      size="lg"
    >
      <form onSubmit={handleSubmit(onSubmit as SubmitHandler<FormValues>)} className="space-y-4">
        <FormField label="Nom de la règle" required placeholder="Rappel cotisation" error={errors.name?.message} {...register("name")} />

        <Controller
          name="triggerType"
          control={control}
          render={({ field }) => (
            <SelectField
              label="Déclencheur"
              required
              options={TRIGGER_OPTIONS}
              value={field.value}
              onValueChange={field.onChange}
            />
          )}
        />

        {/* SCHEDULED_ONCE */}
        {triggerType === "SCHEDULED_ONCE" && (
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Date d'envoi" required type="date" error={errors.date?.message} {...register("date")} />
            <FormField label="Heure" required type="time" {...register("time")} />
          </div>
        )}

        {/* SCHEDULED_RECURRING */}
        {triggerType === "SCHEDULED_RECURRING" && (
          <div className="space-y-3">
            <Controller
              name="frequency"
              control={control}
              render={({ field }) => (
                <SelectField label="Fréquence" options={FREQUENCY_OPTIONS} value={field.value} onValueChange={field.onChange} />
              )}
            />
            {frequency === "weekly" && (
              <Controller
                name="dayOfWeek"
                control={control}
                render={({ field }) => (
                  <SelectField label="Jour de la semaine" options={DAY_OF_WEEK_OPTIONS} value={field.value} onValueChange={field.onChange} />
                )}
              />
            )}
            {frequency === "monthly" && (
              <FormField label="Jour du mois" type="number" min={1} max={28} placeholder="1" {...register("dayOfMonth")} />
            )}
            <FormField label="Heure d'envoi" type="time" {...register("time")} />
          </div>
        )}

        {/* EVENT_COTISATION_DUE */}
        {triggerType === "EVENT_COTISATION_DUE" && (
          <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">Envoie un message aux membres avec une cotisation impayée, N jours avant la date d'échéance.</p>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Jours avant l'échéance" type="number" min={1} placeholder="30" {...register("daysBefore")} />
              <FormField label="Date d'échéance" type="date" {...register("dueDate")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Année de cotisation" type="number" placeholder="2026" {...register("year")} />
              <FormField label="Cooldown (jours)" type="number" min={1} placeholder="7" hint="Délai min. entre 2 envois au même membre" {...register("cooldownDays")} />
            </div>
          </div>
        )}

        {/* EVENT_PAYMENT_OVERDUE */}
        {triggerType === "EVENT_PAYMENT_OVERDUE" && (
          <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">Envoie un message aux membres dont la cotisation est impayée depuis N jours après le 1er janvier.</p>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Jours de retard" type="number" min={1} placeholder="30" {...register("daysAfter")} />
              <FormField label="Année de cotisation" type="number" placeholder="2026" {...register("year")} />
            </div>
            <FormField label="Cooldown (jours)" type="number" min={1} placeholder="7" hint="Délai min. entre 2 envois au même membre" {...register("cooldownDays")} />
          </div>
        )}

        {/* EVENT_REMINDER */}
        {triggerType === "EVENT_REMINDER" && (
          <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">Envoie un rappel automatique aux participants confirmés ou probables, N jours avant chaque événement.</p>
            <FormField
              label="Jours avant l'événement"
              type="number"
              min={1}
              max={30}
              placeholder="1"
              hint="Ex: 1 = la veille, 3 = 3 jours avant"
              {...register("daysBefore")}
            />
          </div>
        )}

        {/* RSVP_CONFIRMED / MEMBER_CREATED */}
        {isEventTrigger && (
          <div className="rounded-lg border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
            {triggerType === "RSVP_CONFIRMED" && "Déclenché automatiquement lorsqu'un membre confirme sa participation à un événement."}
            {triggerType === "MEMBER_CREATED"  && "Déclenché automatiquement lors de l'ajout d'un nouveau membre (rôle Membre uniquement)."}
          </div>
        )}

        {templates.length === 0 ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-300">
            <WarningCircleIcon className="size-4 shrink-0 mt-0.5" />
            <span>Aucun modèle disponible. Créez d'abord un modèle dans l'onglet <strong>Modèles</strong>.</span>
          </div>
        ) : (
          <Controller
            name="templateId"
            control={control}
            render={({ field }) => (
              <SelectField
                label="Modèle de message"
                required
                options={templateOptions}
                value={field.value}
                onValueChange={field.onChange}
                placeholder="Choisir un modèle…"
                error={errors.templateId?.message}
              />
            )}
          />
        )}

        {/* Channel selector — visible only when modules.sms is active */}
        {sms && (
          <Controller
            name="channel"
            control={control}
            render={({ field }) => (
              <SelectField
                label="Canal d'envoi"
                options={CHANNEL_OPTIONS}
                value={field.value}
                onValueChange={field.onChange}
              />
            )}
          />
        )}

        {/* Warning: SMS channel selected but template has no smsBody */}
        {warnMissingSmsBody && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-300">
            <WarningIcon className="size-4 shrink-0 mt-0.5" />
            <span>Le modèle sélectionné n'a pas de corps SMS. Modifiez le modèle pour activer l'envoi SMS.</span>
          </div>
        )}

        {!isEventTrigger && triggerType !== "EVENT_REMINDER" && (
          <Controller
            name="recipients"
            control={control}
            render={({ field }) => (
              <SelectField
                label="Destinataires"
                options={recipientOptions}
                value={field.value}
                onValueChange={field.onChange}
              />
            )}
          />
        )}

        <div className="flex items-center justify-between pt-1">
          {isEditing && messages && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              loading={testMut.isPending}
              title="Envoie un email de test à votre adresse, en utilisant la configuration sauvegardée"
              onClick={async () => {
                try {
                  const res = await testMut.mutateAsync(rule!.id) as { sentTo: string }
                  toast.success(`Email de test envoyé à ${res.sentTo} (config sauvegardée)`)
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : "Erreur")
                }
              }}
            >
              <PaperPlaneTiltIcon className="mr-1.5 size-3.5" /> Tester (config sauvegardée)
            </Button>
          )}
          <div className={`flex gap-2 ${isEditing ? "" : "ml-auto"}`}>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>Annuler</Button>
            <Button type="submit" loading={isPending} disabled={templates.length === 0}>{isEditing ? "Enregistrer" : "Créer"}</Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
