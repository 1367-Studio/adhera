"use client"

import { useEffect, useState } from "react"
import { useForm, useWatch, Controller, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useTranslations } from "next-intl"
import type { FinanceSection } from "@prisma/client"
import { financeCategorySchema, type FinanceCategoryInput } from "@/lib/schemas"
import { referenceAccountsForType, sectionForAccountCode } from "@/lib/finance/chart-of-accounts"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Accordion, AccordionItem, AccordionTrigger, AccordionPanel } from "@/components/ui/accordion"

interface FinanceCategoryFormProps {
  defaultValues?: Partial<FinanceCategoryInput>
  // Accounting codes already used by this association's other categories (the one being
  // edited, if any, is excluded by the caller) — surfaced as a non-blocking warning only,
  // never a hard validation error: associations are free to reuse a code deliberately.
  takenAccountingCodes?: string[]
  // Primary + alternative accounts for the template the user picked (category-template-picker)
  // — shown as quick-pick chips above the full account Select. Absent for a from-scratch
  // custom category, which only has the full Select.
  suggestedAccountingCodes?: string[]
  onSubmit:  (data: FinanceCategoryInput) => Promise<void>
  onCancel:  () => void
  loading?:  boolean
}

export function FinanceCategoryForm({ defaultValues, takenAccountingCodes = [], suggestedAccountingCodes = [], onSubmit, onCancel, loading }: FinanceCategoryFormProps) {
  const t  = useTranslations()
  const tc = useTranslations("finances.categoryForm")

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
    defaultValues: { type: "INCOME", ...defaultValues },
    mode: "onSubmit",
  })

  // "Section" is never a free field the user fills in directly — it's derived from whichever
  // account is chosen (single source of truth: chart-of-accounts.ts). `manualOverride` only
  // turns on when a user deliberately picks a different value under "Options avancées"; while
  // off, `section` is never sent to the API at all, so the server keeps deriving it fresh as
  // the account changes (see the categories API routes).
  const [manualOverride, setManualOverride] = useState(false)
  const [manualSection, setManualSection] = useState<FinanceSection>("OPERATING")
  // Which Accordion item(s) are open — controlled (not just `defaultValue`) so that reopening
  // this same form instance for a DIFFERENT category (the modal reuses one instance; only
  // `defaultValues` changes, see below) re-syncs the panel too, not just on first mount. Starts
  // open whenever that category already carries an active override, so the override isn't
  // hidden behind a click a treasurer has no reason to make.
  const [openAccordionItems, setOpenAccordionItems] = useState<string[]>([])

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

  // manualOverride/manualSection/openAccordionItems are adjusted during RENDER (not inside the
  // effect below) when defaultValuesKey changes — the pattern React itself recommends for
  // "resetting state when a prop changes" (see react.dev "you might not need an effect"):
  // setState calls made synchronously inside an effect body cause an extra wasted render/commit
  // before the correction lands, where doing it here bails out of the stale render before it's
  // ever painted. `reset()` stays in the real effect below since it's a side effect on
  // react-hook-form's own external state, not this component's.
  const [prevDefaultValuesKey, setPrevDefaultValuesKey] = useState(defaultValuesKey)
  if (defaultValuesKey !== prevDefaultValuesKey) {
    setPrevDefaultValuesKey(defaultValuesKey)
    const initialOverride = Boolean(defaultValues?.section) && defaultValues?.section !== sectionForAccountCode(defaultValues?.accountingCode ?? "")
    setManualOverride(initialOverride)
    setManualSection((defaultValues?.section as FinanceSection) ?? "OPERATING")
    setOpenAccordionItems(initialOverride ? ["advanced"] : [])
  }

  useEffect(() => {
    reset({ type: "INCOME", ...defaultValues })
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

  const derivedSection = accountingCode ? sectionForAccountCode(accountingCode) : null
  const effectiveSection: FinanceSection = manualOverride ? manualSection : (derivedSection ?? "OTHER")
  // Only ever suggests accounts that are still valid for the currently selected type — switching
  // Type after picking a template (evenements/EXPENSE has no INCOME-only suggestions left to
  // show) must hide the whole "Comptes suggérés" block, not leave its heading dangling above an
  // empty chip row.
  const visibleSuggestions = suggestedAccountingCodes.filter(code => referenceOptions.some(o => o.value === code))

  async function handleFormSubmit(data: FinanceCategoryInput) {
    await onSubmit({ ...data, section: manualOverride ? manualSection : undefined })
  }

  return (
    <form onSubmit={handleSubmit(handleFormSubmit)} className="space-y-4" noValidate>
      <FormField label={t("finances.categoryForm.name")} required placeholder={t("finances.categoryForm.namePlaceholder")} error={errors.name?.message} {...register("name")} />

      <FormField
        label={t("finances.categoryForm.description")}
        placeholder={t("finances.categoryForm.descriptionPlaceholder")}
        error={errors.description?.message}
        {...register("description")}
      />

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

      {visibleSuggestions.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{tc("suggestedAccounts")}</p>
          <div className="flex flex-wrap gap-1.5">
            {visibleSuggestions.map(code => {
              const account = referenceOptions.find(o => o.value === code)!
              const selected = accountingCode === code
              return (
                <Button
                  key={code}
                  type="button"
                  size="sm"
                  variant={selected ? "default" : "outline"}
                  onClick={() => setValue("accountingCode", code)}
                >
                  {account.label}
                </Button>
              )
            })}
          </div>
          {accountingCode === visibleSuggestions[0] && (
            <p className="text-xs text-muted-foreground">{t("finances.categoryForm.accountingCodeFormwiseNote")}</p>
          )}
        </div>
      )}

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

      <div className="space-y-1">
        <label className="text-sm font-medium">{t("finances.categoryForm.section")}</label>
        <div>
          <Badge variant="outline">
            {derivedSection || manualOverride ? tc(`sectionOptions.${effectiveSection}`) : t("finances.categoryForm.sectionToVerify")}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {manualOverride
            ? t("finances.categoryForm.sectionManualNote")
            : derivedSection
              ? t("finances.categoryForm.sectionAutoNote")
              : t("finances.categoryForm.sectionUnverifiedNote")}
        </p>
      </div>

      <Accordion variant="plain" value={openAccordionItems} onValueChange={setOpenAccordionItems}>
        <AccordionItem value="advanced">
          <AccordionTrigger>{t("finances.categoryForm.advancedOptions")}</AccordionTrigger>
          <AccordionPanel>
            <SelectField
              label={t("finances.categoryForm.section")}
              options={sectionOptions}
              value={effectiveSection}
              onValueChange={value => {
                setManualSection(value as FinanceSection)
                setManualOverride(value !== (derivedSection ?? "OTHER"))
              }}
            />
            {manualOverride && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-2"
                onClick={() => { setManualOverride(false); setManualSection(derivedSection ?? "OPERATING") }}
              >
                {t("finances.categoryForm.revertToAutoSection")}
              </Button>
            )}
          </AccordionPanel>
        </AccordionItem>
      </Accordion>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>{t("common.cancel")}</Button>
        <Button type="submit" loading={loading}>{t("common.save")}</Button>
      </div>
    </form>
  )
}
