"use client"

import { useEffect } from "react"
import { useForm, useWatch, Controller, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { membreSchema, membreCreateSchema, type MembreInput, type MembreCreateInput } from "@/lib/schemas"
import { useMembreTypes } from "@/hooks/use-membre-types"
import { useResponsableOptions } from "@/hooks/use-membres"
import { FormField } from "@/components/ui/form-field"
import { TextareaField } from "@/components/ui/textarea-field"
import { SelectField } from "@/components/ui/select-field"
import { MembreTypeBadge } from "@/components/ui/membre-type-badge"
import { Button } from "@/components/ui/button"
import { ImageUpload } from "../ui/image-upload"

const statusOptions = [
  { value: "PENDING",  label: "En attente" },
  { value: "ACTIF",    label: "Actif"      },
  { value: "INACTIF",  label: "Inactif"    },
  { value: "SUSPENDU", label: "Suspendu"   },
]

// Only ACTIF is safe to self-select — any other status flips User.active to false server-side,
// which would lock the acting manager out of their own account.
const selfStatusOptions = statusOptions.filter(o => o.value === "ACTIF")

const allRoleOptions = [
  { value: "MEMBRE",     label: "Membre"     },
  { value: "SECRETAIRE", label: "Secrétaire" },
  { value: "TRESORIER",  label: "Trésorier"  },
  { value: "PRESIDENT",  label: "Président"  },
  { value: "ADMIN",      label: "Admin"      },
]

const civiliteOptions = [
  { value: "",     label: "Non renseigné" },
  { value: "MME",  label: "Mme"           },
  { value: "MLLE", label: "Mlle"          },
  { value: "M",    label: "M."            },
]

const sexeOptions = [
  { value: "",      label: "Non renseigné" },
  { value: "HOMME", label: "Homme"         },
  { value: "FEMME", label: "Femme"         },
]

const groupeSanguinOptions = [
  { value: "",           label: "Non renseigné" },
  { value: "A_POSITIF",  label: "A+"  },
  { value: "A_NEGATIF",  label: "A-"  },
  { value: "B_POSITIF",  label: "B+"  },
  { value: "B_NEGATIF",  label: "B-"  },
  { value: "AB_POSITIF", label: "AB+" },
  { value: "AB_NEGATIF", label: "AB-" },
  { value: "O_POSITIF",  label: "O+"  },
  { value: "O_NEGATIF",  label: "O-"  },
]

const possedeTshirtOptions = [
  { value: "",      label: "Non renseigné" },
  { value: "true",  label: "Oui"           },
  { value: "false", label: "Non"           },
]

const tailleTshirtOptions = [
  { value: "",     label: "Non renseigné" },
  { value: "XS",   label: "XS"  },
  { value: "S",    label: "S"   },
  { value: "M",    label: "M"   },
  { value: "L",    label: "L"   },
  { value: "XL",   label: "XL"  },
  { value: "XXL",  label: "XXL" },
  { value: "XXXL", label: "XXXL" },
]

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
  const { data: types = [] } = useMembreTypes()
  const { data: responsableCandidates = [] } = useResponsableOptions(membreId)

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
    { value: "", label: "Aucun type" },
    ...types.map(t => ({ value: t.id, label: t.name })),
  ]

  const responsableOptions = responsableCandidates.length > 0
    ? [
        { value: "", label: "Aucun" },
        ...responsableCandidates.map(m => ({ value: m.id, label: `${m.firstName} ${m.lastName}` })),
      ]
    : [{ value: "", label: "Aucun membre majeur disponible" }]

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
          label="Prénom"
          required
          error={errors.firstName?.message}
          {...register("firstName")}
        />
        <FormField
          label="Nom"
          required
          error={errors.lastName?.message}
          {...register("lastName")}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <FormField
          label="Email"
          type="email"
          placeholder="contact@example.com"
          required={isCreate}
          error={errors.email?.message}
          {...register("email")}
        />
        <FormField
          label="Téléphone"
          type="tel"
          placeholder="+33 6 12 34 56 78"
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
                label="Rôle"
                options={roleOptions}
                value={field.value ?? "MEMBRE"}
                onValueChange={field.onChange}
                error={errors.role?.message}
              />
              <p className="text-xs text-muted-foreground">
                Un email d&apos;invitation avec les identifiants sera envoyé à cette adresse.
              </p>
            </div>
          )}
        />
      )}

      <div className="grid grid-cols-2 gap-4">
        <FormField
          label="Date de naissance"
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
              label="Statut"
              required
              options={isSelf ? selfStatusOptions : statusOptions}
              value={field.value}
              onValueChange={field.onChange}
              error={errors.status?.message}
            />
          )}
        />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <Controller
          name="civilite"
          control={control}
          render={({ field }) => (
            <SelectField
              label="Civilité"
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
              label="Sexe"
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
              label="Groupe sanguin"
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
              label="Possède un tee-shirt"
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
              label="Taille du tee-shirt"
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
              label="Responsable légal (si mineur)"
              options={responsableOptions}
              value={field.value ?? ""}
              onValueChange={field.onChange}
              error={errors.responsableId?.message}
            />
          )}
        />
      )}

      <TextareaField
        label="Allergies connues"
        placeholder="Arachides, pollen…"
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
                label="Type de membre"
                options={typeOptions}
                value={field.value ?? ""}
                onValueChange={field.onChange}
                error={errors.typeId?.message}
              />
              {field.value && (() => {
                const t = types.find(t => t.id === field.value)
                return t ? (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <span>Aperçu :</span>
                    <MembreTypeBadge name={t.name} color={t.color} />
                  </div>
                ) : null
              })()}
            </div>
          )}
        />
      )}

      <FormField
        label="Adresse"
        placeholder="12 rue de la Paix, 75001 Paris"
        error={errors.address?.message}
        {...register("address")}
      />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={loading}>
          Annuler
        </Button>
        <Button type="submit" loading={loading}>
          Enregistrer
        </Button>
      </div>
    </form>
  )
}
