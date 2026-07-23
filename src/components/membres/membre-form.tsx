"use client"

import { useEffect } from "react"
import { useForm, Controller, type Resolver } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { membreSchema, membreCreateSchema, type MembreInput, type MembreCreateInput } from "@/lib/schemas"
import { useMembreTypes } from "@/hooks/use-membre-types"
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

interface MembreFormProps {
  defaultValues?: Partial<MembreInput>
  onSubmit: (data: MembreCreateInput) => Promise<void>
  onCancel: () => void
  loading?: boolean
  isCreate?: boolean
  actorRole?: string
  isSelf?: boolean
}

export function MembreForm({ defaultValues, onSubmit, onCancel, loading, isCreate, actorRole, isSelf }: MembreFormProps) {
  const { data: types = [] } = useMembreTypes()

  const { register, control, handleSubmit, reset, formState: { errors } } = useForm<MembreCreateInput>({
    resolver: zodResolver(isCreate ? membreCreateSchema : membreSchema) as unknown as Resolver<MembreCreateInput>,
    defaultValues: { status: "ACTIF", role: "MEMBRE", ...defaultValues },
    mode: "onSubmit",
  })

  useEffect(() => { reset({ status: "ACTIF", role: "MEMBRE", ...defaultValues }) }, [defaultValues, reset])

  const roleOptions = actorRole === "ADMIN" ? allRoleOptions : allRoleOptions.filter(o => o.value !== "ADMIN")

  const typeOptions = [
    { value: "", label: "Aucun type" },
    ...types.map(t => ({ value: t.id, label: t.name })),
  ]

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
