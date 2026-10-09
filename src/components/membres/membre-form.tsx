"use client"

import { MembershipFormFieldInput, type MembershipFormFieldInputField } from "@/components/adhesions/membership-form-field-input"
import { AddressFields } from "@/components/ui/address-fields"
import { Button } from "@/components/ui/button"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { DateField, todayValue } from "@/components/ui/date-field"
import { FormField } from "@/components/ui/form-field"
import { MembreTypeBadge } from "@/components/ui/membre-type-badge"
import { SelectField } from "@/components/ui/select-field"
import { Separator } from "@/components/ui/separator"
import { TextareaField } from "@/components/ui/textarea-field"
import { useRequiredLegalDocuments } from "@/hooks/use-legal-documents"
import { useMembershipTierOptions } from "@/hooks/use-membership-tier-options"
import { useMembreTypes } from "@/hooks/use-membre-types"
import { useResponsableOptions } from "@/hooks/use-membres"
import { LOCALE_LABELS, SUPPORTED_LOCALES } from "@/i18n/locales"
import { addressFormValues, addressWasMigratedFromLegacy, type AddressFormValues } from "@/lib/address"
import { spokenLanguageOptions } from "@/lib/languages"
import { membreCreateSchema, membreSchema, type MembreCreateInput } from "@/lib/schemas"
import { useHasAccess, useModules } from "@/lib/user-context"
import { zodResolver } from "@hookform/resolvers/zod"
import { useTranslations } from "next-intl"
import { useEffect, useState } from "react"
import { Controller, useForm, useWatch, type FieldErrors, type Resolver } from "react-hook-form"
import { toast } from "sonner"
import { z } from "zod"
import { ImageUpload } from "../ui/image-upload"

// Same role set as the PATCH /api/membres/[id] server-side check and cotisation-defaults'
// FINANCE roles — forcing a member's adhérent status is a financial call equivalent to
// marking a cotisation paid, so it's scoped the same way, narrower than general membre
// management (which SECRETAIRE also has).
const FINANCE_ROLES = ["ADMIN", "PRESIDENT", "TRESORIER"]

export type MembreFormValues = z.infer<typeof membreSchema>
type MembreCreateFormValues  = z.infer<typeof membreCreateSchema>

// Même seuil que /api/membres/stats/route.ts et /api/membres/route.ts (adultsOnly).
const ADULT_AGE_YEARS = 18

function isConfirmedAdult(birthDateStr: string): boolean {
  const cutoff = new Date()
  cutoff.setFullYear(cutoff.getFullYear() - ADULT_AGE_YEARS)
  return new Date(birthDateStr + "T12:00:00") <= cutoff
}

interface MembreFormProps {
  defaultValues?: Partial<MembreFormValues>
  onSubmit: (data: MembreCreateInput & Pick<MembreFormValues, "notes" | "imageRightsConsent"> & { answers?: Record<string, string> }) => Promise<void>
  onCancel: () => void
  loading?: boolean
  isCreate?: boolean
  actorRole?: string
  isSelf?: boolean
  membreId?: string
  // Custom fields of the MembershipForm this member actually joined through (see
  // resolveMembreMembershipFormId), pre-filled with their current answers — absent for a
  // member with no traceable form (manual creation), and always absent on create: there is no
  // member yet to have joined through anything.
  editableCustomFields?: { field: MembershipFormFieldInputField; value: string }[]
  // True while editableCustomFields is still being fetched (the members-list quick-edit modal
  // loads it on open, unlike the fiche détail where it's already in hand) — shows a placeholder
  // instead of the section silently popping in after a beat, or never appearing to a manager who
  // saves before the request resolves.
  customFieldsLoading?: boolean
}

export function MembreForm({ defaultValues, onSubmit, onCancel, loading, isCreate, actorRole, isSelf, membreId, editableCustomFields = [], customFieldsLoading }: MembreFormProps) {
  const t = useTranslations()
    const { data: types = [] } = useMembreTypes()
  const { data: responsableCandidates = [] } = useResponsableOptions(membreId)
  const modules = useModules()
  const { data: tierOptionsData = [] } = useMembershipTierOptions(!!isCreate && modules.cotisations)

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

  const preferredLocaleOptions = [
    { value: "", label: t("membres.form.preferredLocaleNone") },
    // Sorted by label — same reasoning as spokenLanguageOptions() below.
    ...SUPPORTED_LOCALES.map(value => ({ value, label: LOCALE_LABELS[value] })).sort((a, b) => a.label.localeCompare(b.label)),
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

  const imageRightsOptions = [
    { value: "",      label: t("membres.form.imageRights.unknown") },
    { value: "true",  label: t("membres.form.imageRights.granted") },
    { value: "false", label: t("membres.form.imageRights.refused") },
  ]

  const { data: requiredLegalDocuments = [] } = useRequiredLegalDocuments()

  const { register, control, handleSubmit, reset, setValue, formState: { errors } } = useForm<MembreCreateFormValues>({
    resolver: zodResolver(isCreate ? membreCreateSchema : membreSchema) as unknown as Resolver<MembreCreateFormValues>,
    defaultValues: { status: "ACTIF", role: "MEMBRE", ...defaultValues, ...addressFormValues(defaultValues) },
    mode: "onSubmit",
  })

  useEffect(() => { reset({ status: "ACTIF", role: "MEMBRE", ...defaultValues, ...addressFormValues(defaultValues) }) }, [defaultValues, reset])

  // Kept outside react-hook-form: the fields (and their ids) vary per member's own
  // MembershipForm, so there is no fixed zod shape to resolve them against like every other
  // field above. Re-seeded whenever the modal opens on a different member.
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>(
    () => Object.fromEntries(editableCustomFields.map(({ field, value }) => [field.id, value])),
  )
  // Keyed on the fields' content, not the array: callers pass a fresh array on every render
  // (the `= []` default when creating, `?? []` in the members list), and depending on that
  // identity re-seeded the state on every render — "Maximum update depth exceeded".
  const customAnswersSeed = JSON.stringify(editableCustomFields.map(({ field, value }) => [field.id, value]))
  useEffect(() => {
    setCustomAnswers(Object.fromEntries(JSON.parse(customAnswersSeed) as [string, string][]))
  }, [customAnswersSeed])
  // Same touched/showAll pattern as the public adhésion form (membership-form-public-form.tsx):
  // a required field only turns red once it's been left, or once a submit was attempted —
  // never on first render, and never merely because another required field failed.
  const [touchedCustomFields, setTouchedCustomFields] = useState<Set<string>>(new Set())
  const [showAllCustomFieldErrors, setShowAllCustomFieldErrors] = useState(false)
  function customFieldError(fieldId: string, required: boolean): string | undefined {
    if (!required || (customAnswers[fieldId] ?? "").trim()) return undefined
    return (showAllCustomFieldErrors || touchedCustomFields.has(fieldId))
      ? t("membershipForms.public.fieldRequired")
      : undefined
  }

  const [addressStreetValue, addressComplementValue, postalCodeValue, cityValue, countryValue] = useWatch({
    control,
    name: ["addressStreet", "addressComplement", "postalCode", "city", "country"],
  })
  const addressValue: AddressFormValues = {
    addressStreet:     addressStreetValue     ?? "",
    addressComplement: addressComplementValue ?? "",
    postalCode:        postalCodeValue        ?? "",
    city:              cityValue              ?? "",
    country:           countryValue           ?? "",
  }

  const birthDateValue     = useWatch({ control, name: "birthDate" })
  const responsableIdValue = useWatch({ control, name: "responsableId" })
  // Hides the field once age is confirmed 18+, to avoid cluttering every adult's fiche —
  // but never hides it if a responsable is already set (e.g. someone who aged out since),
  // or when birthDate is unknown (can't rule out a minor).
  const showResponsableField = !birthDateValue || !isConfirmedAdult(birthDateValue) || !!responsableIdValue

  const [guardianNameValue, guardianPhoneValue, secondGuardianNameValue, secondGuardianPhoneValue] = useWatch({
    control,
    name: ["guardianName", "guardianPhone", "secondGuardianName", "secondGuardianPhone"],
  })
  // Same reasoning as showResponsableField, extended to the whole section: a confirmed adult
  // with nothing on file has no use for four blank guardian fields taking up a full section —
  // but never hide any of it once something is actually filled in, whatever the age.
  const showGuardianFields = showResponsableField
    || !!guardianNameValue || !!guardianPhoneValue || !!secondGuardianNameValue || !!secondGuardianPhoneValue
  // Security audit M2+L8 — the free-text guardian name/phone fields below (not the
  // `responsableId` selector above, a link to another Membre record and not in scope).
  const canSeeSensitive = useHasAccess("sensible", "read")

  const roleOptions = actorRole === "ADMIN" ? allRoleOptions : allRoleOptions.filter(o => o.value !== "ADMIN")

  const typeOptions = [
    { value: "", label: t("membres.form.noType") },
    ...types.map(type => ({ value: type.id, label: type.name })),
  ]

  // "Aucun tarif" keeps the historical behavior (montant par défaut de l'association, ou
  // rien) — the picker only renders when at least one real tarif exists (length > 1).
  const tierOptions = [
    { value: "", label: t("membres.form.tierNone") },
    ...tierOptionsData.map(tier => ({
      value: tier.id,
      label: `${tier.formTitle} — ${tier.label} (${tier.amount.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })})`,
    })),
  ]

  const responsableOptions = responsableCandidates.length > 0
    ? [
        { value: "", label: t("membres.form.noResponsable") },
        ...responsableCandidates.map(m => ({ value: m.id, label: `${m.firstName} ${m.lastName}` })),
      ]
    : [{ value: "", label: t("membres.form.noAdultResponsable") }]

  async function submit(data: MembreCreateInput) {
    // Only the answers actually changed in this session — never the whole set. A required
    // field the member never answered (added to the form after they joined, say) must not
    // block an edit that has nothing to do with it: sending it unchanged would fail the
    // server's required-field check on every single save until someone fills it in.
    const initialCustomAnswers = Object.fromEntries(editableCustomFields.map(({ field, value }) => [field.id, value]))
    const changedCustomAnswers = Object.fromEntries(
      Object.entries(customAnswers).filter(([fieldId, value]) => value !== (initialCustomAnswers[fieldId] ?? "")),
    )
    // Only a *changed* required field is checked here, for the same reason it's the only one
    // sent to the server above — a pre-existing blank on an untouched field is not this save's
    // problem to fix.
    const hasInvalidChangedField = editableCustomFields.some(
      ({ field }) => field.id in changedCustomAnswers && field.required && !(customAnswers[field.id] ?? "").trim(),
    )
    if (hasInvalidChangedField) {
      setShowAllCustomFieldErrors(true)
      return
    }
    await onSubmit(Object.keys(changedCustomAnswers).length > 0 ? { ...data, answers: changedCustomAnswers } : data)
  }

  // Surfaces a failure that would otherwise be silent: groupeSanguin/possedeTshirt/tailleTshirt
  // are still zod-validated even though they're hidden inputs with no visible control to show
  // `errors.*` on (see the CLAUDE.md field-removal above) — if one ever holds a value the schema
  // no longer accepts, clicking Guardar would do nothing at all with zero feedback. A generic
  // toast beats silence for any validation failure, not just that one.
  function onInvalid(formErrors: FieldErrors<MembreCreateFormValues>) {
    if (Object.keys(formErrors).length === 0) return
    toast.error(t("membres.form.invalidFormToast"))
  }

  // Rendered near the top on création (right after Informações pessoais) — cargo et tarif sont
  // souvent la seule raison d'ouvrir "Adicionar", et les enterrer après adresse/langues/
  // responsable légal/droit à l'image forçait un long scroll pour la décision la plus commune.
  // En édition, où ni l'un ni l'autre n'apparaît, la section reste à sa place d'origine — voir
  // l'ordre demandé (Contribuição, Status, Observações).
  const gestaoMembroSection = (
    <fieldset className="space-y-5">
      <legend className="text-sm font-medium">{t("membres.form.sections.management")}</legend>

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

      {isCreate && tierOptions.length > 1 && (
        <Controller
          name="tierId"
          control={control}
          render={({ field }) => (
            <div className="space-y-1.5">
              <SelectField
                label={t("membres.form.fields.cotisationTier")}
                options={tierOptions}
                value={field.value ?? ""}
                onValueChange={field.onChange}
                error={errors.tierId?.message}
              />
              {field.value && (
                <p className="text-xs text-muted-foreground">
                  {t("membres.form.tierNotice")}
                </p>
              )}
            </div>
          )}
        />
      )}

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

      <TextareaField
        label={t("membres.form.fields.notes")}
        placeholder={t("membres.form.fields.notesPlaceholder")}
        rows={4}
        maxLength={5000}
        error={errors.notes?.message}
        {...register("notes")}
      />
    </fieldset>
  )

  return (
    // PILOTE espacement (voir la discussion sur la densité des formulaires) : 20px entre
    // champs au lieu de 16, pour que l'écart entre deux champs se distingue nettement des
    // 6px qui séparent un label de son propre contrôle. À généraliser si validé.
    <form onSubmit={handleSubmit(submit, onInvalid)} className="space-y-6" noValidate>
      {/* Groupe sanguin / t-shirt / allergies : retirés de l'affichage (voir CLAUDE.md) mais
          gardés enregistrés en hidden — la valeur déjà en base repart inchangée à chaque save,
          sans jamais être écrasée, même si plus personne ne peut la modifier depuis ce
          formulaire. */}
      <input type="hidden" {...register("groupeSanguin")} />
      <input type="hidden" {...register("possedeTshirt")} />
      <input type="hidden" {...register("tailleTshirt")} />
      <input type="hidden" {...register("allergies")} />

      <fieldset className="space-y-5">
        <legend className="text-sm font-medium">{t("membres.form.sections.personalInfo")}</legend>

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

        <div className="grid grid-cols-2 gap-x-4 gap-y-5">
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

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-5">
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
          {/* Enregistré dans Membre.answers sous la clé "mobile", pas dans une colonne — voir
              src/lib/membre-answers.ts. Sans ce champ, un numéro saisi par l'adhérent sur le
              formulaire public n'était plus modifiable nulle part. */}
          <FormField
            label={t("membres.form.fields.mobile")}
            type="tel"
            placeholder={t("membres.form.fields.mobilePlaceholder")}
            error={errors.mobile?.message}
            {...register("mobile")}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-5">
          <Controller
            name="birthDate"
            control={control}
            render={({ field }) => (
              <DateField
                label={t("membres.form.fields.birthDate")}
                // Nobody is born tomorrow — the picker refuses future months outright rather
                // than letting one be chosen and rejected afterwards.
                max={todayValue()}
                value={field.value ?? ""}
                onChange={field.onChange}
                error={errors.birthDate?.message}
              />
            )}
          />
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
        </div>
      </fieldset>

      {isCreate && gestaoMembroSection}

      <Separator />

      <div className="space-y-5">
        <AddressFields
          value={addressValue}
          onChange={patch => {
            for (const [fieldName, fieldValue] of Object.entries(patch) as [keyof AddressFormValues, string][]) {
              setValue(fieldName, fieldValue, { shouldDirty: true })
            }
          }}
          legacyHint={addressWasMigratedFromLegacy(defaultValues)}
          errors={{
            addressStreet:     errors.addressStreet?.message,
            addressComplement: errors.addressComplement?.message,
            postalCode:        errors.postalCode?.message,
            city:              errors.city?.message,
            country:           errors.country?.message,
          }}
        />
      </div>

      <fieldset className="space-y-5">
        <legend className="text-sm font-medium">{t("membres.form.sections.memberInfo")}</legend>

        {/* Empilés plutôt que côte à côte : « Langue de communication » est plus long que
            « Langue parlée » et passe sur deux lignes dans la largeur d'une colonne de modale,
            ce qui désalignait les deux champs l'un à côté de l'autre. */}
        <div className="space-y-3">
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
          <div className="space-y-1.5">
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
            <p className="text-xs text-muted-foreground">{t("membres.form.preferredLocaleHint")}</p>
          </div>
        </div>

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
      </fieldset>

      {/* Le sélecteur de responsable pointe vers un autre membre ; les responsables ci-dessous
          sont saisis en texte libre sur la fiche du membre lui-même (Membre.guardianName…). Les
          deux sont réunis ici car ils répondent à la même question : qui est responsable de ce
          membre s'il est mineur. Toute la section se cache pour un adulte confirmé sans rien de
          renseigné — voir showGuardianFields — pour ne pas infliger quatre champs vides à la
          quasi-totalité des fiches. */}
      {showGuardianFields && (
        <>
          <Separator />
          <div className="space-y-5">
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

            {canSeeSensitive && (
              <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
                <FormField
                  label={t("membres.form.fields.guardianName", { number: 1 })}
                  error={errors.guardianName?.message}
                  {...register("guardianName")}
                />
                <FormField
                  label={t("membres.form.fields.guardianPhone", { number: 1 })}
                  type="tel"
                  error={errors.guardianPhone?.message}
                  {...register("guardianPhone")}
                />
                <FormField
                  label={t("membres.form.fields.guardianName", { number: 2 })}
                  error={errors.secondGuardianName?.message}
                  {...register("secondGuardianName")}
                />
                <FormField
                  label={t("membres.form.fields.guardianPhone", { number: 2 })}
                  type="tel"
                  error={errors.secondGuardianPhone?.message}
                  {...register("secondGuardianPhone")}
                />
              </div>
            )}
          </div>
        </>
      )}

      <fieldset className="space-y-5">
        <legend className="text-sm font-medium">{t("membres.form.sections.additionalInfo")}</legend>
        <Controller
          name="imageRightsConsent"
          control={control}
          render={({ field }) => (
            <SelectField
              id="membre-image-rights"
              label={t("membres.form.fields.imageRights")}
              options={imageRightsOptions}
              value={field.value ?? ""}
              onValueChange={field.onChange}
              error={errors.imageRightsConsent?.message}
            />
          )}
        />
      </fieldset>

      {!isCreate && gestaoMembroSection}

      {/* Réponses au formulaire d'adhésion réellement utilisé par ce membre (voir
          resolveMembreMembershipFormId) — jamais l'ancien formulaire figé d'origine. Absent
          pour un membre créé manuellement, faute de formulaire à qui rattacher des réponses.
          Pendant le chargement (édition rapide depuis la liste, qui va chercher ces réponses
          après ouverture du modal — voir membres-view.tsx), un texte tient la place plutôt que
          de laisser la section apparaître sans prévenir une fois la requête terminée. */}
      {customFieldsLoading && editableCustomFields.length === 0 ? (
        <p className="text-xs text-muted-foreground border-t pt-5">
          {t("membres.form.customFieldsLoading")}
        </p>
      ) : editableCustomFields.length > 0 && (
        <div className="space-y-5 border-t pt-5">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {t("membres.form.customFieldsSectionTitle")}
          </p>
          {editableCustomFields.map(({ field }) => (
            <MembershipFormFieldInput
              key={field.id}
              field={field}
              value={customAnswers[field.id] ?? ""}
              onChange={value => setCustomAnswers(prev => ({ ...prev, [field.id]: value }))}
              onBlur={() => setTouchedCustomFields(prev => new Set(prev).add(field.id))}
              error={customFieldError(field.id, field.required)}
            />
          ))}
        </div>
      )}

      {/* Création par un gestionnaire : la personne n'est pas là pour accepter elle-même. Le
          gestionnaire atteste avoir recueilli son accord, et c'est cette affirmation qui est
          enregistrée, à son nom — jamais déduite automatiquement. */}
      {isCreate && requiredLegalDocuments.length > 0 && (
        <Controller
          name="legalOfflineAttestation"
          control={control}
          render={({ field }) => (
            <CheckboxField
              id="membre-legal-attestation"
              checked={!!field.value}
              onChange={event => field.onChange(event.target.checked)}
              label={t("legalConsent.offlineAttestation")}
              hint={`${t("legalConsent.offlineAttestationHint")} ${requiredLegalDocuments.map(document => document.title).join(", ")}`}
            />
          )}
        />
      )}

      <div className="flex justify-end gap-2 pt-3">
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
