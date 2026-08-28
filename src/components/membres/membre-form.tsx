"use client"

import { useEffect } from "react"
import { useForm, useWatch, Controller, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useTranslations } from "next-intl"
import { membreSchema, membreCreateSchema, type MembreInput, type MembreCreateInput } from "@/lib/schemas"
import { useMembreTypes } from "@/hooks/use-membre-types"
import { useResponsableOptions } from "@/hooks/use-membres"
import { useModules } from "@/lib/user-context"
import { FormField } from "@/components/ui/form-field"
import { TextareaField } from "@/components/ui/textarea-field"
import { SelectField } from "@/components/ui/select-field"
import { MembreTypeBadge } from "@/components/ui/membre-type-badge"
import { Button } from "@/components/ui/button"
import { ImageUpload } from "../ui/image-upload"
import { SUPPORTED_LOCALES, LOCALE_LABELS } from "@/i18n/locales"
import { spokenLanguageOptions } from "@/lib/languages"

// Same role set as the PATCH /api/membres/[id] server-side check and cotisation-defaults'
// FINANCE roles — forcing a member's adhérent status is a financial call equivalent to
// marking a cotisation paid, so it's scoped the same way, narrower than general membre
// management (which SECRETAIRE also has).
const FINANCE_ROLES = ["ADMIN", "PRESIDENT", "TRESORIER"]

const GROUPE_SANGUIN_VALUES = ["A_POSITIF", "A_NEGATIF", "B_POSITIF", "B_NEGATIF", "AB_POSITIF", "AB_NEGATIF", "O_POSITIF", "O_NEGATIF"] as const
const GROUPE_SANGUIN_LABELS: Record<(typeof GROUPE_SANGUIN_VALUES)[number], string> = {
  A_POSITIF: "A+", A_NEGATIF: "A-", B_POSITIF: "B+", B_NEGATIF: "B-",
  AB_POSITIF: "AB+", AB_NEGATIF: "AB-", O_POSITIF: "O+", O_NEGATIF: "O-",
}

const TAILLE_TSHIRT_VALUES = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"] as const

// Même seuil que /api/membres/stats/route.ts et /api/membres/route.ts (adultsOnly).
const ADULT_AGE_YEARS = 18

function isConfirmedAdult(birthDateStr: string): boolean {
  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - ADULT_AGE_YEARS)
  return new Date(birthDateStr + "T12:00:00") <= cutoff
}

interface MembreFormProps {
  defaultValues?: Partial<MembreInput>
  onSubmit: (data: MembreCreateInput) => Promise<void>
  onCancel: () => void
  loading?: boolean
  isCreate?: boolean
  actorRole?: string
  isSelf?: boolean
  membreId?: string
}

export function MembreForm({ defaultValues, onSubmit, onCancel, loading, isCreate, actorRole, isSelf, membreId }: MembreFormProps) {
  const t = useTranslations()
    const { data: types = [] } = useMembreTypes()
  const { data: responsableCandidates = [] } = useResponsableOptions(membreId)
  const modules = useModules()

  const statusOptions = [
    { value: "PENDING",  label: t("membres.form.status.pending")  },
    { value: "ACTIF",    label: t("membres.form.status.actif")    },
    { value: "INACTIF",  label: t("membres.form.status.inactif")  },
    { value: "SUSPENDU", label: t("membres.form.status.suspendu") },
  ]
  // Only ACTIF is safe to self-select — any other status flips User.active to false server-side,
  // which would lock the acting manager out of their own account.
  const selfStatusOptions = statusOptions.filter(o => o.value === "ACTIF")

  const allRoleOptions = [
    { value: "MEMBRE",     label: t("membres.form.role.membre")     },
    { value: "SECRETAIRE", label: t("membres.form.role.secretaire") },
    { value: "TRESORIER",  label: t("membres.form.role.tresorier")  },
    { value: "PRESIDENT",  label: t("membres.form.role.president")  },
    { value: "ADMIN",      label: t("membres.form.role.admin")      },
  ]

  const civiliteOptions = [
    { value: "",     label: t("membres.form.civilite.none") },
    { value: "MME",  label: t("membres.form.civilite.mme")  },
    { value: "MLLE", label: t("membres.form.civilite.mlle") },
    { value: "M",    label: t("membres.form.civilite.m")    },
  ]

  const sexeOptions = [
    { value: "",      label: t("membres.form.sexe.none")  },
    { value: "HOMME", label: t("membres.form.sexe.homme") },
    { value: "FEMME", label: t("membres.form.sexe.femme") },
  ]

  const groupeSanguinOptions = [
    { value: "", label: t("membres.form.groupeSanguinNone") },
    ...GROUPE_SANGUIN_VALUES.map(value => ({ value, label: GROUPE_SANGUIN_LABELS[value] })),
  ]

  const preferredLocaleOptions = [
    { value: "", label: t("membres.form.preferredLocaleNone") },
    ...SUPPORTED_LOCALES.map(value => ({ value, label: LOCALE_LABELS[value] })),
  ]
  const spokenLanguageSelectOptions = [
    { value: "", label: t("membres.form.spokenLanguageNone") },
    ...spokenLanguageOptions(),
  ]

  const adherentOverrideOptions = [
    { value: "",      label: t("membres.form.adherentOverride.auto")          },
    { value: "true",  label: t("membres.form.adherentOverride.forceAdherent") },
    { value: "false", label: t("membres.form.adherentOverride.forceBenevole") },
  ]

  const possedeTshirtOptions = [
    { value: "",      label: t("membres.form.tailleTshirtNone") },
    { value: "true",  label: t("common.yes") },
    { value: "false", label: t("common.no")  },
  ]

  const tailleTshirtOptions = [
    { value: "", label: t("membres.form.tailleTshirtNone") },
    ...TAILLE_TSHIRT_VALUES.map(value => ({ value, label: value })),
  ]

  const { register, control, handleSubmit, reset, setValue, formState: { errors } } = useForm<MembreCreateInput>({
    resolver: zodResolver(isCreate ? membreCreateSchema : membreSchema) as unknown as Resolver<MembreCreateInput>,
    defaultValues: { status: "ACTIF", role: "MEMBRE", ...defaultValues },
    mode: "onSubmit",
  })

  useEffect(() => { reset({ status: "ACTIF", role: "MEMBRE", ...defaultValues }) }, [defaultValues, reset])

  const birthDateValue     = useWatch({ control, name: "birthDate" })
  const responsableIdValue = useWatch({ control, name: "responsableId" })
  // Hides the field once age is confirmed 18+, to avoid cluttering every adult's fiche —
  // but never hides it if a responsable is already set (e.g. someone who aged out since),
  // or when birthDate is unknown (can't rule out a minor).
  const showResponsableField = !birthDateValue || !isConfirmedAdult(birthDateValue) || !!responsableIdValue

  const roleOptions = actorRole === "ADMIN" ? allRoleOptions : allRoleOptions.filter(o => o.value !== "ADMIN")

  const typeOptions = [
    { value: "", label: t("membres.form.noType") },
    ...types.map(type => ({ value: type.id, label: type.name })),
  ]

  const responsableOptions = responsableCandidates.length > 0
    ? [
        { value: "", label: t("membres.form.noResponsable") },
        ...responsableCandidates.map(m => ({ value: m.id, label: `${m.firstName} ${m.lastName}` })),
      ]
    : [{ value: "", label: t("membres.form.noAdultResponsable") }]

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <Controller
        name="photoUrl"
        control={control}
        render={({ field }) => (
          <div className="flex justify-center">
            <ImageUpload
              value={field.value ?? ""}
              onChange={field.onChange}
              prefix="membres"
              aspectRatio="square"
              className="w-32"
              compact
            />
          </div>
        )}
      />
      <div className="grid grid-cols-2 gap-4">
        <FormField
          label={t("membres.form.fields.firstName")}
          required
          error={errors.firstName?.message}
          {...register("firstName")}
        />
        <FormField
          label={t("membres.form.fields.lastName")}
          required
          error={errors.lastName?.message}
          {...register("lastName")}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField
          label={t("membres.form.fields.email")}
          type="email"
          placeholder={t("membres.form.fields.emailPlaceholder")}
          required={isCreate}
          error={errors.email?.message}
          {...register("email")}
        />
        <FormField
          label={t("membres.form.fields.phone")}
          type="tel"
          placeholder={t("membres.form.fields.phonePlaceholder")}
          error={errors.phone?.message}
          {...register("phone")}
        />
      </div>

      {isCreate && (
        <Controller
          name="role"
          control={control}
          render={({ field }) => (
            <div className="space-y-1.5">
              <SelectField
                label={t("membres.form.fields.role")}
                options={roleOptions}
                value={field.value ?? "MEMBRE"}
                onValueChange={field.onChange}
                error={errors.role?.message}
              />
              <p className="text-xs text-muted-foreground">
                {t("membres.form.invitationNotice")}
              </p>
            </div>
          )}
        />
      )}

      <div className="grid grid-cols-2 gap-4">
        <FormField
          label={t("membres.form.fields.birthDate")}
          type="date"
          max={new Date().toISOString().split("T")[0]}
          error={errors.birthDate?.message}
          {...register("birthDate")}
        />
        <Controller
          name="status"
          control={control}
          render={({ field }) => (
            <SelectField
              label={t("membres.form.fields.status")}
              required
              options={isSelf ? selfStatusOptions : statusOptions}
              value={field.value}
              onValueChange={field.onChange}
              error={errors.status?.message}
            />
          )}
        />
      </div>
      {!isCreate && modules.cotisations && actorRole && FINANCE_ROLES.includes(actorRole) && (
        <Controller
          name="adherentOverride"
          control={control}
          render={({ field }) => (
            <div className="space-y-1.5 rounded-lg border bg-muted/20 p-3">
              <SelectField
                label={t("membres.form.fields.adhesionCotisation")}
                options={adherentOverrideOptions}
                value={field.value ?? ""}
                onValueChange={field.onChange}
                error={errors.adherentOverride?.message}
              />
              <p className="text-xs text-muted-foreground">
                {responsableIdValue
                  ? t("membres.form.adherentAutoWithResponsable")
                  : t("membres.form.adherentAutoNoResponsable")}
              </p>
            </div>
          )}
        />
      )}
      <div className="grid grid-cols-3 gap-4">
        <Controller
          name="civilite"
          control={control}
          render={({ field }) => (
            <SelectField
              label={t("membres.form.fields.civilite")}
              options={civiliteOptions}
              value={field.value ?? ""}
              onValueChange={field.onChange}
              error={errors.civilite?.message}
            />
          )}
        />
        <Controller
          name="sexe"
          control={control}
          render={({ field }) => (
            <SelectField
              label={t("membres.form.fields.sexe")}
              options={sexeOptions}
              value={field.value ?? ""}
              onValueChange={field.onChange}
              error={errors.sexe?.message}
            />
          )}
        />
        <Controller
          name="groupeSanguin"
          control={control}
          render={({ field }) => (
            <SelectField
              label={t("membres.form.fields.groupeSanguin")}
              options={groupeSanguinOptions}
              value={field.value ?? ""}
              onValueChange={field.onChange}
              error={errors.groupeSanguin?.message}
            />
          )}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Controller
          name="possedeTshirt"
          control={control}
          render={({ field }) => (
            <SelectField
              label={t("membres.form.fields.possedeTshirt")}
              options={possedeTshirtOptions}
              value={field.value ?? ""}
              onValueChange={(v) => {
                field.onChange(v)
                // A size doesn't make sense once "does not have a t-shirt" is selected —
                // clear it so the two fields can't contradict each other.
                if (v === "false") setValue("tailleTshirt", "")
              }}
              error={errors.possedeTshirt?.message}
            />
          )}
        />
        <Controller
          name="tailleTshirt"
          control={control}
          render={({ field }) => (
            <SelectField
              label={t("membres.form.fields.tailleTshirt")}
              options={tailleTshirtOptions}
              value={field.value ?? ""}
              onValueChange={field.onChange}
              error={errors.tailleTshirt?.message}
            />
          )}
        />
      </div>

      {showResponsableField && (
        <Controller
          name="responsableId"
          control={control}
          render={({ field }) => (
            <SelectField
              label={t("membres.form.fields.responsable")}
              options={responsableOptions}
              value={field.value ?? ""}
              onValueChange={field.onChange}
              error={errors.responsableId?.message}
            />
          )}
        />
      )}

      <Controller
        name="preferredLocale"
        control={control}
        render={({ field }) => (
          <SelectField
            label={t("membres.form.fields.preferredLocale")}
            options={preferredLocaleOptions}
            value={field.value ?? ""}
            onValueChange={field.onChange}
            error={errors.preferredLocale?.message}
          />
        )}
      />

      <Controller
        name="spokenLanguage"
        control={control}
        render={({ field }) => (
          <SelectField
            label={t("membres.form.fields.spokenLanguage")}
            options={spokenLanguageSelectOptions}
            value={field.value ?? ""}
            onValueChange={field.onChange}
            error={errors.spokenLanguage?.message}
          />
        )}
      />

      <TextareaField
        label={t("membres.form.fields.allergies")}
        placeholder={t("membres.form.fields.allergiesPlaceholder")}
        rows={2}
        error={errors.allergies?.message}
        {...register("allergies")}
      />

      {/* Type de membre */}
      {types.length > 0 && (
        <Controller
          name="typeId"
          control={control}
          render={({ field }) => (
            <div className="space-y-1.5">
              <SelectField
                label={t("membres.form.fields.type")}
                options={typeOptions}
                value={field.value ?? ""}
                onValueChange={field.onChange}
                error={errors.typeId?.message}
              />
              {field.value && (() => {
                const matchedType = types.find(type => type.id === field.value)
                return matchedType ? (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span>{t("membres.form.preview")}</span>
                    <MembreTypeBadge name={matchedType.name} color={matchedType.color} />
                  </div>
                ) : null
              })()}
            </div>
          )}
        />
      )}

      <FormField
        label={t("membres.form.fields.address")}
        placeholder={t("membres.form.fields.addressPlaceholder")}
        error={errors.address?.message}
        {...register("address")}
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
