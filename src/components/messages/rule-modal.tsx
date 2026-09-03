"use client"

import { useEffect } from "react"
import { DateField } from "@/components/ui/date-field"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { WarningCircleIcon, WarningIcon, PaperPlaneTiltIcon } from "@phosphor-icons/react/dist/ssr";
import { Modal } from "@/components/ui/modal"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { Button } from "@/components/ui/button"
import { useCreateRule, useUpdateRule, useTestSendRule, useBirthdayCoverage, type AutomationRule, type RuleInput, type TriggerType, type MessageChannel } from "@/hooks/use-automation-rules"
import type { Resolver, SubmitHandler } from "react-hook-form"
import { useMessageTemplates } from "@/hooks/use-message-templates"
import { useMembreTypes } from "@/hooks/use-membre-types"
import { useModules } from "@/lib/user-context"

type Translator = ReturnType<typeof useTranslations>

const EVENT_TRIGGERS: TriggerType[] = ["RSVP_CONFIRMED", "MEMBER_CREATED"]

function buildSchema(t: Translator) {
  return z.object({
    name:          z.string().min(1, t("messages.ruleModal.validation.required")),
    templateId:    z.string().min(1, t("messages.ruleModal.validation.required")),
    triggerType:   z.enum(["SCHEDULED_ONCE", "SCHEDULED_RECURRING", "EVENT_COTISATION_DUE", "EVENT_PAYMENT_OVERDUE", "EVENT_REMINDER", "RSVP_CONFIRMED", "MEMBER_CREATED", "MEMBER_BIRTHDAY", "EVENT_ADHERENT_LAPSED"]),
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
      ctx.addIssue({ code: "custom", path: ["date"], message: t("messages.ruleModal.validation.required") })
    }
  })
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>

function getTriggerOptions(t: Translator) {
  return [
    { value: "SCHEDULED_ONCE",        label: t("messages.ruleModal.triggerOptions.scheduledOnce") },
    { value: "SCHEDULED_RECURRING",   label: t("messages.ruleModal.triggerOptions.scheduledRecurring") },
    { value: "EVENT_COTISATION_DUE",  label: t("messages.ruleModal.triggerOptions.eventCotisationDue") },
    { value: "EVENT_PAYMENT_OVERDUE", label: t("messages.ruleModal.triggerOptions.eventPaymentOverdue") },
    { value: "EVENT_REMINDER",        label: t("messages.ruleModal.triggerOptions.eventReminder") },
    { value: "RSVP_CONFIRMED",        label: t("messages.ruleModal.triggerOptions.rsvpConfirmed") },
    { value: "MEMBER_CREATED",        label: t("messages.ruleModal.triggerOptions.memberCreated") },
    { value: "MEMBER_BIRTHDAY",       label: t("messages.ruleModal.triggerOptions.memberBirthday") },
    { value: "EVENT_ADHERENT_LAPSED", label: t("messages.ruleModal.triggerOptions.eventAdherentLapsed") },
  ]
}

// Default cooldownDays per trigger type — kept in sync with each processor's own
// `config.cooldownDays ?? N` fallback in src/app/api/cron/automations/route.ts, so a rule
// created without touching the field behaves the same as what its placeholder implies.
const COOLDOWN_DEFAULTS: Partial<Record<TriggerType, string>> = {
  EVENT_COTISATION_DUE:  "7",
  EVENT_PAYMENT_OVERDUE: "7",
  EVENT_ADHERENT_LAPSED: "30",
}

function getChannelOptions(t: Translator) {
  return [
    { value: "EMAIL", label: t("messages.ruleModal.channelOptions.email") },
    { value: "SMS",   label: t("messages.ruleModal.channelOptions.sms") },
    { value: "BOTH",  label: t("messages.ruleModal.channelOptions.both") },
  ]
}

function getFrequencyOptions(t: Translator) {
  return [
    { value: "daily",   label: t("messages.ruleModal.frequencyOptions.daily") },
    { value: "weekly",  label: t("messages.ruleModal.frequencyOptions.weekly") },
    { value: "monthly", label: t("messages.ruleModal.frequencyOptions.monthly") },
  ]
}

function getDayOfWeekOptions(t: Translator) {
  return [
    { value: "1", label: t("messages.ruleModal.dayOfWeekOptions.monday") },
    { value: "2", label: t("messages.ruleModal.dayOfWeekOptions.tuesday") },
    { value: "3", label: t("messages.ruleModal.dayOfWeekOptions.wednesday") },
    { value: "4", label: t("messages.ruleModal.dayOfWeekOptions.thursday") },
    { value: "5", label: t("messages.ruleModal.dayOfWeekOptions.friday") },
    { value: "6", label: t("messages.ruleModal.dayOfWeekOptions.saturday") },
    { value: "0", label: t("messages.ruleModal.dayOfWeekOptions.sunday") },
  ]
}

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
  rule?:        AutomationRule | null
}

export function RuleModal({ open, onOpenChange, rule }: Props) {
  const t = useTranslations()
  const TRIGGER_OPTIONS     = getTriggerOptions(t)
  const CHANNEL_OPTIONS     = getChannelOptions(t)
  const FREQUENCY_OPTIONS   = getFrequencyOptions(t)
  const DAY_OF_WEEK_OPTIONS = getDayOfWeekOptions(t)

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

  const { register, handleSubmit, reset, watch, control, setValue, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver:      zodResolver(buildSchema(t)) as Resolver<FormValues>,
    defaultValues,
  })

  const triggerType = watch("triggerType") as TriggerType
  const channel     = watch("channel") as MessageChannel
  const frequency   = watch("frequency")
  const templateId  = watch("templateId")
  const recipients  = watch("recipients")

  const recipientTypeId = recipients?.startsWith("TYPE:") ? recipients.slice(5) : undefined
  const { data: birthdayCoverage } = useBirthdayCoverage(open && triggerType === "MEMBER_BIRTHDAY", recipientTypeId)

  const isEventTrigger       = EVENT_TRIGGERS.includes(triggerType)
  const selectedTemplate     = templates.find(tpl => tpl.id === templateId)
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
    if (values.triggerType === "EVENT_ADHERENT_LAPSED") {
      return { cooldownDays: Number(values.cooldownDays) }
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
        toast.success(t("messages.ruleModal.toasts.updated"))
      } else {
        await createMut.mutateAsync(payload)
        toast.success(t("messages.ruleModal.toasts.created"))
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  const templateOptions = templates.map(tpl => ({
    value: tpl.id,
    label: tpl.name + (sms && tpl.smsBody ? " ✦" : "") + (!tpl.active ? t("messages.ruleModal.templateInactiveSuffix") : ""),
  }))
  const recipientOptions = [
    { value: "ALL", label: t("messages.ruleModal.recipientsAll") },
    ...membreTypes.map(mt => ({ value: `TYPE:${mt.id}`, label: t("messages.ruleModal.recipientsType", { name: mt.name }) })),
  ]

  const isPending = isSubmitting || createMut.isPending || updateMut.isPending

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={isEditing ? t("messages.ruleModal.editTitle") : t("messages.ruleModal.newTitle")}
      size="lg"
    >
      <form onSubmit={handleSubmit(onSubmit as SubmitHandler<FormValues>)} className="space-y-4">
        <FormField label={t("messages.ruleModal.ruleName")} required placeholder={t("messages.ruleModal.ruleNamePlaceholder")} error={errors.name?.message} {...register("name")} />

        <Controller
          name="triggerType"
          control={control}
          render={({ field }) => (
            <SelectField
              label={t("messages.ruleModal.trigger")}
              required
              options={TRIGGER_OPTIONS}
              value={field.value}
              onValueChange={(v) => {
                field.onChange(v)
                // Only for a brand-new rule — editing an existing one already loaded its
                // real saved cooldownDays via the reset() in the effect above, and switching
                // trigger type while editing shouldn't clobber that.
                const fallback = COOLDOWN_DEFAULTS[v as TriggerType]
                if (!isEditing && fallback) setValue("cooldownDays", fallback)
              }}
            />
          )}
        />

        {/* SCHEDULED_ONCE */}
        {triggerType === "SCHEDULED_ONCE" && (
          <div className="grid grid-cols-2 gap-3">
            <Controller
              name="date"
              control={control}
              render={({ field }) => (
                <DateField label={t("messages.ruleModal.sendDate")} required allowFuture value={field.value ?? ""} onChange={field.onChange} error={errors.date?.message} />
              )}
            />
            <FormField label={t("messages.ruleModal.time")} required type="time" {...register("time")} />
          </div>
        )}

        {/* SCHEDULED_RECURRING */}
        {triggerType === "SCHEDULED_RECURRING" && (
          <div className="space-y-3">
            <Controller
              name="frequency"
              control={control}
              render={({ field }) => (
                <SelectField label={t("messages.ruleModal.frequency")} options={FREQUENCY_OPTIONS} value={field.value} onValueChange={field.onChange} />
              )}
            />
            {frequency === "weekly" && (
              <Controller
                name="dayOfWeek"
                control={control}
                render={({ field }) => (
                  <SelectField label={t("messages.ruleModal.dayOfWeek")} options={DAY_OF_WEEK_OPTIONS} value={field.value} onValueChange={field.onChange} />
                )}
              />
            )}
            {frequency === "monthly" && (
              <FormField label={t("messages.ruleModal.dayOfMonth")} type="number" min={1} max={28} placeholder="1" {...register("dayOfMonth")} />
            )}
            <FormField label={t("messages.ruleModal.sendTime")} type="time" {...register("time")} />
          </div>
        )}

        {/* EVENT_COTISATION_DUE */}
        {triggerType === "EVENT_COTISATION_DUE" && (
          <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">{t("messages.ruleModal.cotisationDueHint")}</p>
            <div className="grid grid-cols-2 gap-3">
              <FormField label={t("messages.ruleModal.daysBeforeDue")} type="number" min={1} placeholder="30" {...register("daysBefore")} />
              <Controller
                name="dueDate"
                control={control}
                render={({ field }) => (
                  <DateField label={t("messages.ruleModal.dueDate")} allowFuture value={field.value ?? ""} onChange={field.onChange} />
                )}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField label={t("messages.ruleModal.cotisationYear")} type="number" placeholder="2026" {...register("year")} />
              <FormField label={t("messages.ruleModal.cooldownDays")} type="number" min={1} placeholder="7" hint={t("messages.ruleModal.cooldownHint")} {...register("cooldownDays")} />
            </div>
          </div>
        )}

        {/* EVENT_PAYMENT_OVERDUE */}
        {triggerType === "EVENT_PAYMENT_OVERDUE" && (
          <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">{t("messages.ruleModal.paymentOverdueHint")}</p>
            <div className="grid grid-cols-2 gap-3">
              <FormField label={t("messages.ruleModal.daysOverdue")} type="number" min={1} placeholder="30" {...register("daysAfter")} />
              <FormField label={t("messages.ruleModal.cotisationYear")} type="number" placeholder="2026" {...register("year")} />
            </div>
            <FormField label={t("messages.ruleModal.cooldownDays")} type="number" min={1} placeholder="7" hint={t("messages.ruleModal.cooldownHint")} {...register("cooldownDays")} />
          </div>
        )}

        {/* EVENT_REMINDER */}
        {triggerType === "EVENT_REMINDER" && (
          <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">{t("messages.ruleModal.eventReminderHint")}</p>
            <FormField
              label={t("messages.ruleModal.daysBeforeEvent")}
              type="number"
              min={1}
              max={30}
              placeholder="1"
              hint={t("messages.ruleModal.daysBeforeEventHint")}
              {...register("daysBefore")}
            />
          </div>
        )}

        {/* EVENT_ADHERENT_LAPSED */}
        {triggerType === "EVENT_ADHERENT_LAPSED" && (
          <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
            <p className="text-xs text-muted-foreground">
              {t("messages.ruleModal.adherentLapsedHint")}
            </p>
            <FormField label={t("messages.ruleModal.cooldownDays")} type="number" min={1} placeholder="30" hint={t("messages.ruleModal.cooldownHint")} {...register("cooldownDays")} />
          </div>
        )}

        {/* MEMBER_BIRTHDAY */}
        {triggerType === "MEMBER_BIRTHDAY" && (
          <div className="space-y-2">
            <div className="rounded-lg border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
              {t("messages.ruleModal.birthdayHint")}
            </div>
            {birthdayCoverage && birthdayCoverage.withBirthDate === 0 && birthdayCoverage.total > 0 && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300">
                <WarningIcon className="size-4 shrink-0 mt-0.5" />
                <span>
                  {recipientTypeId
                    ? t("messages.ruleModal.birthdayNoDateWarningType", { count: birthdayCoverage.total })
                    : t("messages.ruleModal.birthdayNoDateWarningAll", { count: birthdayCoverage.total })
                  }
                </span>
              </div>
            )}
            {birthdayCoverage && birthdayCoverage.withBirthDate > 0 && (
              <p className="text-xs text-muted-foreground">
                {recipientTypeId
                  ? t("messages.ruleModal.birthdayCoverageType", { withDate: birthdayCoverage.withBirthDate, total: birthdayCoverage.total })
                  : t("messages.ruleModal.birthdayCoverage", { withDate: birthdayCoverage.withBirthDate, total: birthdayCoverage.total })
                }
              </p>
            )}
          </div>
        )}

        {/* RSVP_CONFIRMED / MEMBER_CREATED */}
        {isEventTrigger && (
          <div className="rounded-lg border bg-muted/20 px-3 py-2.5 text-xs text-muted-foreground">
            {triggerType === "RSVP_CONFIRMED" && t("messages.ruleModal.rsvpConfirmedHint")}
            {triggerType === "MEMBER_CREATED"  && t("messages.ruleModal.memberCreatedHint")}
          </div>
        )}

        {templates.length === 0 ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-300">
            <WarningCircleIcon className="size-4 shrink-0 mt-0.5" />
            <span>
              {t("messages.ruleModal.noTemplatesWarningPrefix")}
              <strong>{t("messages.view.tabs.templates")}</strong>
              {t("messages.ruleModal.noTemplatesWarningSuffix")}
            </span>
          </div>
        ) : (
          <Controller
            name="templateId"
            control={control}
            render={({ field }) => (
              <SelectField
                label={t("messages.ruleModal.templateLabel")}
                required
                options={templateOptions}
                value={field.value}
                onValueChange={field.onChange}
                placeholder={t("messages.ruleModal.templatePlaceholder")}
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
                label={t("messages.ruleModal.channel")}
                options={CHANNEL_OPTIONS}
                value={field.value}
                onValueChange={field.onChange}
              />
            )}
          />
        )}

        {/* Warning: selected template is deactivated — rule would silently never send */}
        {selectedTemplate && !selectedTemplate.active && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-300">
            <WarningIcon className="size-4 shrink-0 mt-0.5" />
            <span>
              {t("messages.ruleModal.templateDeactivatedWarningPrefix")}
              <strong>{t("messages.view.tabs.templates")}</strong>
              {t("messages.ruleModal.templateDeactivatedWarningSuffix")}
            </span>
          </div>
        )}

        {/* Warning: SMS channel selected but template has no smsBody */}
        {warnMissingSmsBody && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 px-3 py-2.5 text-sm text-amber-800 dark:text-amber-300">
            <WarningIcon className="size-4 shrink-0 mt-0.5" />
            <span>{t("messages.ruleModal.missingSmsBodyWarning")}</span>
          </div>
        )}

        {!isEventTrigger && triggerType !== "EVENT_REMINDER" && (
          <Controller
            name="recipients"
            control={control}
            render={({ field }) => (
              <SelectField
                label={t("messages.ruleModal.recipients")}
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
              title={t("messages.ruleModal.testTooltip")}
              onClick={async () => {
                try {
                  const res = await testMut.mutateAsync(rule!.id) as { sentTo: string }
                  toast.success(t("messages.ruleModal.toasts.testSent", { email: res.sentTo }))
                } catch (err) {
                  toast.error(err instanceof Error ? err.message : t("common.error"))
                }
              }}
            >
              <PaperPlaneTiltIcon className="mr-1.5 size-3.5" /> {t("messages.ruleModal.test")}
            </Button>
          )}
          <div className={`flex gap-2 ${isEditing ? "" : "ml-auto"}`}>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>{t("common.cancel")}</Button>
            <Button type="submit" loading={isPending} disabled={templates.length === 0}>{isEditing ? t("common.save") : t("messages.ruleModal.create")}</Button>
          </div>
        </div>
      </form>
    </Modal>
  )
}
