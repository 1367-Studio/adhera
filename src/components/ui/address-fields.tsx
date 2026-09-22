"use client"

import { useTranslations } from "next-intl"
import { FormField } from "@/components/ui/form-field"
import type { AddressFormValues } from "@/lib/address"

type Props = {
  value:     AddressFormValues
  onChange:  (patch: Partial<AddressFormValues>) => void
  // Rend la voie, le code postal et la ville obligatoires. Le complément et le pays ne le
  // sont jamais : le premier est facultatif par nature, le second est vide pour la quasi-
  // totalité des adresses françaises (formatAddress omet simplement la ligne).
  required?: boolean
  disabled?: boolean
  errors?:   Partial<Record<keyof AddressFormValues, string>>
  // Obligatoire dès que le bloc est répété dans un même formulaire (co-inscrits d'une
  // adhésion, participants d'un événement) : sans lui, FormField dérive l'id du libellé et
  // tous les blocs partageraient les mêmes id, si bien que cliquer un libellé mettrait le
  // focus sur le champ d'une autre personne.
  idPrefix?: string
}

export function AddressFields({ value, onChange, required, disabled, errors, idPrefix }: Props) {
  const t = useTranslations("address")
  const fieldId = (name: keyof AddressFormValues) => (idPrefix ? `${idPrefix}-${name}` : name)

  return (
    <div className="grid grid-cols-6 gap-x-4 gap-y-5">
      <div className="col-span-6">
        <FormField
          id={fieldId("addressStreet")}
          label={t("street")}
          required={required}
          disabled={disabled}
          error={errors?.addressStreet}
          value={value.addressStreet}
          onChange={event => onChange({ addressStreet: event.target.value })}
        />
      </div>

      <div className="col-span-6">
        <FormField
          id={fieldId("addressComplement")}
          label={t("complement")}
          placeholder={t("complementPlaceholder")}
          disabled={disabled}
          error={errors?.addressComplement}
          value={value.addressComplement}
          onChange={event => onChange({ addressComplement: event.target.value })}
        />
      </div>

      <div className="col-span-2">
        <FormField
          id={fieldId("postalCode")}
          label={t("postalCode")}
          required={required}
          disabled={disabled}
          inputMode="numeric"
          autoComplete="postal-code"
          error={errors?.postalCode}
          value={value.postalCode}
          onChange={event => onChange({ postalCode: event.target.value })}
        />
      </div>

      <div className="col-span-4">
        <FormField
          id={fieldId("city")}
          label={t("city")}
          required={required}
          disabled={disabled}
          autoComplete="address-level2"
          error={errors?.city}
          value={value.city}
          onChange={event => onChange({ city: event.target.value })}
        />
      </div>

      <div className="col-span-6 sm:col-span-3">
        <FormField
          id={fieldId("country")}
          label={t("country")}
          disabled={disabled}
          autoComplete="country-name"
          error={errors?.country}
          value={value.country}
          onChange={event => onChange({ country: event.target.value })}
        />
      </div>
    </div>
  )
}
