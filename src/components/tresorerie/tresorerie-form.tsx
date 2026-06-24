"use client"

import { useEffect } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { tresorerieSchema, type TresorerieInput } from "@/lib/schemas"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { CurrencyField } from "@/components/ui/currency-field"
import { Button } from "@/components/ui/button"

const typeOptions = [
  { value: "ENTREE", label: "Entrée  (recette)" },
  { value: "SORTIE", label: "Sortie  (dépense)" },
]

const categoryOptions = [
  { value: "",               label: "Aucune"         },
  { value: "Cotisations",    label: "Cotisations"    },
  { value: "Subventions",    label: "Subventions"    },
  { value: "Dons",           label: "Dons"           },
  { value: "Événements",     label: "Événements"     },
  { value: "Fournitures",    label: "Fournitures"    },
  { value: "Déplacements",   label: "Déplacements"   },
  { value: "Communication",  label: "Communication"  },
  { value: "Loyer",          label: "Loyer"          },
  { value: "Autre",          label: "Autre"          },
]

interface TresorerieFormProps {
  defaultValues?: Partial<TresorerieInput>
  onSubmit: (data: TresorerieInput) => Promise<void>
  onCancel: () => void
  loading?: boolean
}

export function TresorerieForm({ defaultValues, onSubmit, onCancel, loading }: TresorerieFormProps) {
  const { register, control, handleSubmit, reset, formState: { errors } } = useForm<TresorerieInput>({
    resolver: zodResolver(tresorerieSchema),
    defaultValues: { date: new Date().toISOString().split("T")[0], ...defaultValues },
    mode: "onSubmit",
  })

  useEffect(() => {
    reset({ date: new Date().toISOString().split("T")[0], ...defaultValues })
  }, [defaultValues, reset])

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="grid grid-cols-2 gap-4">
        <Controller
          name="type"
          control={control}
          render={({ field }) => (
            <SelectField
              label="Type"
              required
              options={typeOptions}
              value={field.value}
              onValueChange={field.onChange}
              error={errors.type?.message}
            />
          )}
        />
        <FormField
          label="Date"
          type="date"
          required
          error={errors.date?.message}
          {...register("date")}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Controller
          name="amount"
          control={control}
          render={({ field }) => (
            <CurrencyField
              label="Montant"
              required
              value={field.value ?? 0}
              onChange={field.onChange}
              onBlur={field.onBlur}
              error={errors.amount?.message}
            />
          )}
        />
        <Controller
          name="category"
          control={control}
          render={({ field }) => (
            <SelectField
              label="Catégorie"
              options={categoryOptions}
              value={field.value ?? ""}
              onValueChange={field.onChange}
              error={errors.category?.message}
              placeholder="Sélectionner…"
            />
          )}
        />
      </div>

      <FormField
        label="Description"
        required
        placeholder="Ex: Remboursement frais déplacement AG"
        error={errors.description?.message}
        {...register("description")}
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
