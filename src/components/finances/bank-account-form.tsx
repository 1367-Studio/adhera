"use client"

import { useEffect } from "react"
import { useForm, Controller, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { bankAccountSchema, type BankAccountInput } from "@/lib/schemas"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { CurrencyField } from "@/components/ui/currency-field"
import { Button } from "@/components/ui/button"

const currencyOptions = [
  { value: "EUR", label: "EUR — Euro" },
  { value: "USD", label: "USD — Dollar" },
  { value: "BRL", label: "BRL — Real" },
  { value: "CHF", label: "CHF — Franc suisse" },
  { value: "GBP", label: "GBP — Livre sterling" },
]

interface BankAccountFormProps {
  defaultValues?: Partial<BankAccountInput>
  onSubmit:  (data: BankAccountInput) => Promise<void>
  onCancel:  () => void
  loading?:  boolean
}

export function BankAccountForm({ defaultValues, onSubmit, onCancel, loading }: BankAccountFormProps) {
  const { register, control, handleSubmit, reset, formState: { errors } } = useForm<BankAccountInput>({
    resolver: zodResolver(bankAccountSchema) as Resolver<BankAccountInput>,
    defaultValues: { currency: "EUR", openingBalance: 0, isActive: true, ...defaultValues },
    mode: "onSubmit",
  })

  useEffect(() => {
    reset({ currency: "EUR", openingBalance: 0, isActive: true, ...defaultValues })
  }, [defaultValues, reset])

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="grid grid-cols-2 gap-4">
        <FormField label="Nom de la banque" required placeholder="Ex: Crédit Agricole" error={errors.bankName?.message} {...register("bankName")} />
        <FormField label="Nom du compte"    required placeholder="Ex: Compte principal"  error={errors.accountName?.message} {...register("accountName")} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField label="4 derniers chiffres IBAN" placeholder="Ex: 4242" maxLength={4} error={errors.ibanLast4?.message} {...register("ibanLast4")} />
        <Controller
          name="currency"
          control={control}
          render={({ field }) => (
            <SelectField label="Devise" options={currencyOptions} value={field.value} onValueChange={field.onChange} error={errors.currency?.message} />
          )}
        />
      </div>

      <Controller
        name="openingBalance"
        control={control}
        render={({ field }) => (
          <CurrencyField label="Solde d'ouverture" value={field.value ?? 0} onChange={field.onChange} onBlur={field.onBlur} error={errors.openingBalance?.message} />
        )}
      />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>Annuler</Button>
        <Button type="submit" loading={loading}>Enregistrer</Button>
      </div>
    </form>
  )
}
