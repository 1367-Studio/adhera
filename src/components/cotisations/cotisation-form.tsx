"use client"

import { Badge } from "@/components/ui/badge"
import { DateField } from "@/components/ui/date-field"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { CurrencyField, CurrencyInput } from "@/components/ui/currency-field"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { TextareaField } from "@/components/ui/textarea-field"
import { cotisationSchema, cotisationUpdateSchema, type CotisationInput } from "@/lib/schemas"
import { zodResolver } from "@hookform/resolvers/zod"
import { PlusIcon, TrashIcon } from "@phosphor-icons/react/dist/ssr"
import { useTranslations } from "next-intl"
import { useEffect, useState } from "react"
import { Controller, useFieldArray, useForm, type Resolver } from "react-hook-form"
import { toast } from "sonner"

type MembreOption = { id: string; firstName: string; lastName: string }
type RawCotisationStatus = "EN_ATTENTE" | "PARTIELLEMENT_PAYEE" | "PAYE" | "EN_RETARD" | "EXONERE" | "ANNULEE"

// The Select works with plain strings — "AUTO" is a local sentinel standing in for
// status: null (the form's "Automatique" option), never sent to the API as a literal value.
const AUTO = "AUTO"
const EPSILON = 0.01

const emptyInstallment = { amount: 0, dueDate: "" }

const fmt = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

// Splits `amount` into `count` échéances that sum back to it exactly in cents — plain
// division (amount / count) drifts on rounding (100 / 3 = 33.333...), which would fail the
// server's own sum-must-equal-amount check the moment the admin saved without hand-fixing a
// cent somewhere. Distributes the leftover cents across the first few installments instead of
// dumping them all on the last one.
function splitEvenly(amount: number, count: number): number[] {
  // `count` floored defensively — Array.from({length}) truncates a non-integer length on its
  // own (2.5 silently becomes 2), which would generate fewer rows than the number shown in
  // the count input. The onChange handler below already clamps to an integer, but this keeps
  // the function correct on its own regardless of what a future caller passes.
  const n = Math.max(1, Math.floor(count))
  const totalCents = Math.round(amount * 100)
  const base        = Math.floor(totalCents / n)
  const remainder    = totalCents - base * n
  return Array.from({ length: n }, (_, i) => (base + (i < remainder ? 1 : 0)) / 100)
}

const rawStatusBadge: Record<RawCotisationStatus, { variant: "default" | "secondary" | "destructive" | "outline" }> = {
  EN_ATTENTE:          { variant: "secondary"   },
  PARTIELLEMENT_PAYEE: { variant: "outline"     },
  PAYE:                { variant: "default"     },
  EN_RETARD:           { variant: "destructive" },
  EXONERE:             { variant: "outline"     },
  ANNULEE:             { variant: "secondary"   },
}

interface CotisationFormProps {
  membres:       MembreOption[]
  defaultValues?: Partial<CotisationInput>
  onSubmit:      (data: CotisationInput) => Promise<void>
  onCancel:      () => void
  loading?:      boolean
  editMode?:     boolean
  /** Amount already paid on this cotisation (0 for a new one) — used to warn before exempting
   *  (which deletes recorded payments) and to block editing installments once money has moved. */
  amountPaid?:   number
  /** The cotisation's actual current status as stored today (undefined for a brand-new
   *  cotisation) — shown read-only next to the status select so picking "Automatique" doesn't
   *  leave the admin guessing what that resolves to without leaving the form. */
  currentStatus?: RawCotisationStatus
}

export function CotisationForm({ membres, defaultValues, onSubmit, onCancel, loading, editMode, amountPaid = 0, currentStatus }: CotisationFormProps) {
  const t = useTranslations()
  const [confirmExonereOpen, setConfirmExonereOpen] = useState(false)

  // EN_ATTENTE/PARTIELLEMENT_PAYEE/PAYE/EN_RETARD are never offered here — they're derived
  // automatically from payments/dueDate/installments (see deriveCotisationStatus). Only
  // EXONERE/ANNULEE are real manual overrides; "Automatique" clears any override and lets
  // the system compute the status on save. All three are always selectable — picking
  // "Automatique" or "Annulée" is always safe (see the route's own deriveCotisationStatus /
  // MANUAL_STATUSES guard); "Exonérée" deletes recorded payments, so that one is confirmed
  // below instead of ever being disabled outright.
  const statusOptions = [
    { value: AUTO,      label: t("cotisations.form.statusAuto")             },
    { value: "EXONERE", label: t("membres.detail.cotisationStatus.exonere") },
    { value: "ANNULEE", label: t("membres.detail.cotisationStatus.annulee") },
  ]

  const { register, control, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<CotisationInput>({
    resolver: zodResolver(editMode ? cotisationUpdateSchema : cotisationSchema) as unknown as Resolver<CotisationInput>,
    defaultValues: { status: null, year: new Date().getFullYear(), installments: [], ...defaultValues },
    mode: "onSubmit",
  })

  useEffect(() => {
    reset({ status: null, year: new Date().getFullYear(), installments: [], ...defaultValues })
  }, [defaultValues, reset])

  const { fields, append, remove, replace } = useFieldArray({ control, name: "installments" })
  const [installmentCount, setInstallmentCount] = useState(3)

  const status       = watch("status")
  const watchedAmount = watch("amount")
  // Number.isFinite (not `?? 0`) — a nullish coalesce only catches null/undefined, and
  // "amount <= 0" below would silently pass a stray NaN through instead of catching it
  // (NaN <= 0 is false), which would generate NaN-valued installments.
  const amount        = Number.isFinite(watchedAmount) ? watchedAmount! : 0
  const installments  = watch("installments") ?? []
  const installmentsTotal = installments.reduce((sum, i) => sum + (i.amount || 0), 0)
  const installmentsMismatch = installments.length > 0 && Math.abs(installmentsTotal - amount) > EPSILON
  // Mirrors the PATCH route's own guard: once a payment exists, changing the schedule would
  // silently shift what the payment-waterfall considers "covered" — see the route for details.
  const installmentsLocked = editMode && amountPaid > EPSILON

  // Quick-start: split the total into N équal(ish) échéances instead of making the admin
  // type each amount and do the addition themselves — due dates are left for them to fill in,
  // since there's no sensible default to guess (monthly? quarterly? starting when?). Existing
  // rows' due dates are kept when the count doesn't change and only re-splits the amounts, so
  // regenerating after tweaking `amount` doesn't throw away dates already entered.
  function handleGenerateInstallments() {
    // Button stays enabled either way (rather than silently disabled with no feedback) —
    // clicking it without an amount set surfaces a toast instead of just doing nothing.
    if (amount <= 0) {
      toast.error(t("cotisations.form.installments.amountRequiredHint"))
      return
    }
    const amounts = splitEvenly(amount, installmentCount)
    // installments (from watch(), live) — not `fields` from useFieldArray, whose items only
    // update on structural changes (append/remove/replace), not on every keystroke into the
    // uncontrolled due-date inputs below.
    replace(amounts.map((a, i) => ({ amount: a, dueDate: installments[i]?.dueDate ?? "" })))
  }

  function handleStatusChange(v: string) {
    if (v === "EXONERE" && amountPaid > EPSILON) {
      setConfirmExonereOpen(true)
      return
    }
    setValue("status", v === AUTO ? null : (v as "EXONERE" | "ANNULEE"))
  }

  const membreOptions = membres.map(m => ({
    value: m.id,
    label: `${m.lastName} ${m.firstName}`,
  }))

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      {!editMode && (
        <Controller
          name="membreId"
          control={control}
          render={({ field }) => (
            <SelectField
              label={t("cotisations.form.member")}
              required
              options={membreOptions}
              value={field.value}
              onValueChange={field.onChange}
              error={errors.membreId?.message}
              placeholder={t("cotisations.form.memberPlaceholder")}
            />
          )}
        />
      )}

      <div className="grid grid-cols-2 gap-4">
        <FormField
          label={t("cotisations.form.year")}
          type="number"
          required
          error={errors.year?.message}
          {...register("year", { valueAsNumber: true })}
        />
        <Controller
          name="amount"
          control={control}
          render={({ field }) => (
            <CurrencyField
              label={t("cotisations.form.amount")}
              required
              value={field.value ?? 0}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={errors.amount?.message}
            />
          )}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <SelectField
            label={t("membres.form.fields.status")}
            required
            options={statusOptions}
            value={status ?? AUTO}
            onValueChange={handleStatusChange}
            error={errors.status?.message}
          />
          {editMode && currentStatus && (
            <p className="text-xs text-muted-foreground">
              {t("cotisations.form.currentStatusLabel")}{" "}
              <Badge variant={rawStatusBadge[currentStatus].variant} className="align-middle">
                {t(`membres.detail.cotisationStatus.${currentStatus === "EN_ATTENTE" ? "enAttente" : currentStatus === "PARTIELLEMENT_PAYEE" ? "partiellementPayee" : currentStatus === "PAYE" ? "paye" : currentStatus === "EN_RETARD" ? "enRetard" : currentStatus === "EXONERE" ? "exonere" : "annulee"}`)}
              </Badge>
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Controller
            name="dueDate"
            control={control}
            render={({ field }) => (
              <DateField label={t("cotisations.form.dueDate")} allowFuture value={field.value ?? ""} onChange={field.onChange} error={errors.dueDate?.message} />
            )}
          />
          {fields.length > 0 && (
            <p className="text-xs text-muted-foreground">{t("cotisations.form.installments.dueDateIgnoredHint")}</p>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground -mt-2">{t("cotisations.form.statusAutoHint")}</p>

      <ConfirmDialog
        open={confirmExonereOpen}
        onOpenChange={setConfirmExonereOpen}
        title={t("cotisations.form.exonereConfirmTitle")}
        description={t("cotisations.form.exonereConfirmDescription")}
        confirmLabel={t("common.confirm")}
        onConfirm={() => { setValue("status", "EXONERE"); setConfirmExonereOpen(false) }}
      />

      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{t("cotisations.form.installments.title")}</p>
        {!installmentsLocked && (
          <div className="flex items-end gap-2">
            <div className="w-24">
              <FormField
                label={t("cotisations.form.installments.count")}
                type="number"
                min={2}
                max={60}
                value={installmentCount}
                onChange={e => setInstallmentCount(Math.max(2, Math.min(60, Math.floor(Number(e.target.value)) || 2)))}
              />
            </div>
            {/* Always enabled (see handleGenerateInstallments) — a disabled button with no
                amount filled in gave no feedback at all and just looked broken. */}
            <Button type="button" variant="outline" size="sm" onClick={handleGenerateInstallments}>
              {t("cotisations.form.installments.generate")}
            </Button>
          </div>
        )}
        {fields.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("cotisations.form.installments.none")}</p>
        )}
        {fields.length > 0 && (
          <div className="space-y-2">
            {fields.map((field, index) => (
              <div key={field.id} className="flex items-end gap-2">
                <div className="flex-1">
                  <Controller
                    name={`installments.${index}.amount`}
                    control={control}
                    render={({ field }) => (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium">{t("cotisations.form.amount")}</p>
                        <CurrencyInput value={field.value ?? 0} onChange={field.onChange} disabled={installmentsLocked} />
                      </div>
                    )}
                  />
                </div>
                <div className="flex-1">
                  <Controller
                    name={`installments.${index}.dueDate`}
                    control={control}
                    render={({ field }) => (
                      <DateField
                        label={t("cotisations.form.dueDate")}
                        allowFuture
                        disabled={installmentsLocked}
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        error={errors.installments?.[index]?.dueDate?.message}
                      />
                    )}
                  />
                </div>
                {!installmentsLocked && (
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => remove(index)}>
                    <TrashIcon className="size-3.5" />
                  </Button>
                )}
              </div>
            ))}
            <p className={installmentsMismatch ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
              {t("cotisations.form.installments.total", { total: fmt(installmentsTotal), amount: fmt(amount) })}
            </p>
          </div>
        )}
        {errors.installments?.message && (
          <p className="text-xs text-destructive">{errors.installments.message}</p>
        )}
        {installmentsLocked ? (
          <p className="text-xs text-muted-foreground">{t("cotisations.form.installments.lockedHint")}</p>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => append(emptyInstallment)}>
            <PlusIcon className="mr-1.5 size-3.5" />
            {t("cotisations.form.installments.add")}
          </Button>
        )}
      </div>

      <TextareaField
        label={t("cotisations.form.note")}
        placeholder={t("cotisations.form.notePlaceholder")}
        rows={2}
        error={errors.note?.message}
        {...register("note")}
      />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" loading={loading}>
          {t("common.save")}
        </Button>
      </div>
    </form>
  )
}
