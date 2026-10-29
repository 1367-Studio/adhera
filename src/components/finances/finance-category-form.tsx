"use client"

import { useEffect } from "react"
import { useForm, useWatch, Controller, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useTranslations } from "next-intl"
import { financeCategorySchema, type FinanceCategoryInput } from "@/lib/schemas"
import { referenceAccountsForType } from "@/lib/finance/chart-of-accounts"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { Button } from "@/components/ui/button"

interface FinanceCategoryFormProps {
  defaultValues?: Partial<FinanceCategoryInput>
  // Accounting codes already used by this association's other categories (the one being
  // edited, if any, is excluded by the caller) — surfaced as a non-blocking warning only,
  // never a hard validation error: associations are free to reuse a code deliberately.
  takenAccountingCodes?: string[]
  onSubmit:  (data: FinanceCategoryInput) => Promise<void>
  onCancel:  () => void
  loading?:  boolean
}

export function FinanceCategoryForm({ defaultValues, takenAccountingCodes = [], onSubmit, onCancel, loading }: FinanceCategoryFormProps) {
  const t = useTranslations()

  const typeOptions = [
    { value: "INCOME",  label: t("finances.categoryForm.typeIncome")  },
    { value: "EXPENSE", label: t("finances.categoryForm.typeExpense") },
  ]

  const sectionOptions = [
    { value: "OPERATING",      label: t("finances.categoryForm.sectionOptions.OPERATING")      },
    { value: "FINANCIAL",      label: t("finances.categoryForm.sectionOptions.FINANCIAL")      },
    { value: "EXCEPTIONAL",    label: t("finances.categoryForm.sectionOptions.EXCEPTIONAL")    },
    { value: "OTHER",          label: t("finances.categoryForm.sectionOptions.OTHER")          },
    { value: "IN_KIND",        label: t("finances.categoryForm.sectionOptions.IN_KIND")        },
    { value: "IMMOBILISATION", label: t("finances.categoryForm.sectionOptions.IMMOBILISATION") },
  ]

  const { register, control, handleSubmit, reset, setValue, formState: { errors } } = useForm<FinanceCategoryInput>({
    resolver: zodResolver(financeCategorySchema) as Resolver<FinanceCategoryInput>,
    defaultValues: { type: "INCOME", section: "OPERATING", ...defaultValues },
    mode: "onSubmit",
  })

  // Keyed on the serialized CONTENT of defaultValues, not the object reference — every caller
  // (categories-view.tsx, previsionnel-global-tab.tsx, add-category-to-project-modal.tsx)
  // passes a fresh `{ type: ... }` / `{ name, type, ... }` object literal on every one of ITS
  // own re-renders, which happens constantly while this form is open (e.g. the Modal's
  // `loading={mutation.isPending}` prop flips the instant Guardar is clicked, well before the
  // request resolves). Depending on the raw object reference re-fired this effect — and wiped
  // the in-progress Select picks back to the target's ORIGINAL values — on every one of those
  // renders, which a treasurer would see as the form silently reverting while they're mid-edit,
  // and which corrupted a resubmit after a validation error (e.g. retrying after "ce nom existe
  // déjà" with accountingCode reset to undefined) into a confusing raw Zod crash instead of the
  // real message. Content-based keying only resets when the actual target changes.
  const defaultValuesKey = JSON.stringify(defaultValues ?? {})
  useEffect(() => {
    reset({ type: "INCOME", section: "OPERATING", ...defaultValues })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultValuesKey, reset])

  const type = useWatch({ control, name: "type" })
  const accountingCode = useWatch({ control, name: "accountingCode" })

  const referenceOptions = referenceAccountsForType(type).map(a => ({ value: a.code, label: `${a.code} — ${a.label}` }))
  // An existing category created before accountingCode became a controlled list (or just
  // carrying a stale/freeform value) can hold a code that isn't one of today's reference
  // accounts. Without this, the Select would just render blank with no indication of what the
  // category's current value even is — a treasurer editing it has no way to tell whether
  // nothing is selected or something invalid is. Surfacing it as its own clearly-labeled option
  // keeps it visible and selected until they deliberately pick a real one (required to save).
  const isLegacyCode = Boolean(accountingCode) && !referenceOptions.some(o => o.value === accountingCode)
  const accountingCodeOptions = isLegacyCode
    ? [{ value: accountingCode!, label: t("finances.categoryForm.accountingCodeLegacyOption", { code: accountingCode! }) }, ...referenceOptions]
    : referenceOptions

  const isDuplicateAccountingCode = Boolean(accountingCode && takenAccountingCodes.includes(accountingCode.trim()))

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <FormField label={t("finances.categoryForm.name")} required placeholder={t("finances.categoryForm.namePlaceholder")} error={errors.name?.message} {...register("name")} />

      <Controller
        name="type"
        control={control}
        render={({ field }) => (
          <SelectField
            label={t("finances.categoryForm.type")} required options={typeOptions} value={field.value} error={errors.type?.message}
            onValueChange={value => {
              field.onChange(value)
              // A code valid for INCOME is never valid for EXPENSE (see chart-of-accounts.ts) —
              // clear the stale pick instead of letting it silently fail validation on submit.
              setValue("accountingCode", "")
            }}
          />
        )}
      />

      <Controller
        name="accountingCode"
        control={control}
        render={({ field }) => (
          <SelectField
            label={t("finances.categoryForm.accountingCode")} required options={accountingCodeOptions}
            placeholder={t("finances.categoryForm.accountingCodePlaceholder")}
            value={field.value} onValueChange={field.onChange} error={errors.accountingCode?.message}
          />
        )}
      />
      {isLegacyCode && (
        <p className="-mt-3 text-xs text-destructive">{t("finances.categoryForm.accountingCodeLegacyWarning")}</p>
      )}
      {!isLegacyCode && isDuplicateAccountingCode && (
        <p className="-mt-3 text-xs text-muted-foreground">{t("finances.categoryForm.accountingCodeDuplicateWarning")}</p>
      )}

      <Controller
        name="section"
        control={control}
        render={({ field }) => (
          <SelectField label={t("finances.categoryForm.section")} options={sectionOptions} value={field.value} onValueChange={field.onChange} error={errors.section?.message} />
        )}
      />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>{t("common.cancel")}</Button>
        <Button type="submit" loading={loading}>{t("common.save")}</Button>
      </div>
    </form>
  )
}
