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
  // Voir addressWasMigratedFromLegacy (src/lib/address.ts) : affiche un avertissement sous
  // la Rue quand elle vient d'y être déposée telle quelle depuis l'ancienne adresse en texte
  // libre, pour éviter que Code postal/Ville saisis à côté ne dupliquent ce qu'elle contient
  // déjà.
  legacyHint?: boolean
}

// Une quinzaine de pays courants pour les associations qui utilisent Formwise — suggestions
// via <datalist>, jamais imposées : le champ reste du texte libre (voir le commentaire sur
// `required` ci-dessus), juste moins sujet aux variantes ("France" / "FR" / "france") sur un
// champ qui alimente aussi les documents officiels.
const COUNTRY_SUGGESTIONS = [
  "France", "Belgique", "Suisse", "Luxembourg", "Allemagne", "Espagne", "Italie",
  "Portugal", "Pays-Bas", "Royaume-Uni", "Irlande", "Canada", "Maroc", "Algérie", "Tunisie",
]

export function AddressFields({ value, onChange, required, disabled, errors, idPrefix, legacyHint }: Props) {
  const t = useTranslations("address")
  const fieldId = (name: keyof AddressFormValues) => (idPrefix ? `${idPrefix}-${name}` : name)
  const countryListId = fieldId("country") + "-suggestions"

  return (
    <div className="grid grid-cols-6 gap-x-4 gap-y-5">
      <div className="col-span-6">
        <FormField
          id={fieldId("addressStreet")}
          label={t("street")}
          required={required}
          disabled={disabled}
          autoComplete="address-line1"
          hint={legacyHint ? t("legacyMigratedHint") : undefined}
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
          autoComplete="address-line2"
          error={errors?.addressComplement}
          value={value.addressComplement}
          onChange={event => onChange({ addressComplement: event.target.value })}
        />
      </div>

      <div className="col-span-6 sm:col-span-2">
        <FormField
          id={fieldId("postalCode")}
          label={t("postalCode")}
          required={required}
          disabled={disabled}
          autoComplete="postal-code"
          error={errors?.postalCode}
          value={value.postalCode}
          onChange={event => onChange({ postalCode: event.target.value })}
        />
      </div>

      <div className="col-span-6 sm:col-span-4">
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
          list={countryListId}
          error={errors?.country}
          value={value.country}
          onChange={event => onChange({ country: event.target.value })}
        />
        <datalist id={countryListId}>
          {COUNTRY_SUGGESTIONS.map(country => <option key={country} value={country} />)}
        </datalist>
      </div>
    </div>
  )
}
