"use client"

import { useEffect } from "react"
import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { z } from "zod"
import { toast } from "sonner"
import { Modal } from "@/components/ui/modal"
import { FormField } from "@/components/ui/form-field"
import { SelectField } from "@/components/ui/select-field"
import { Button } from "@/components/ui/button"
import { useCreateMaterial, useUpdateMaterial, type Material, type MaterialInput, type MaterialStatus } from "@/hooks/use-materiel"

const schema = z.object({
  name:          z.string().min(1, "Requis").max(150),
  category:      z.string().max(80).optional(),
  description:   z.string().max(1000).optional(),
  serialNumber:  z.string().max(100).optional(),
  quantity:      z.number().int().min(1, "Min. 1"),
  status:        z.enum(["DISPONIBLE", "EN_USE", "EN_MAINTENANCE", "HORS_SERVICE", "PERDU"]),
  location:      z.string().max(150).optional(),
  purchaseDate:  z.string().optional(),
  purchasePrice: z.string().optional(),
  notes:         z.string().max(1000).optional(),
})

type FormValues = z.infer<typeof schema>

const STATUS_OPTIONS = [
  { value: "DISPONIBLE",     label: "Disponible" },
  { value: "EN_USE",         label: "En utilisation" },
  { value: "EN_MAINTENANCE", label: "En maintenance" },
  { value: "HORS_SERVICE",   label: "Hors service" },
  { value: "PERDU",          label: "Perdu" },
]

export const MATERIAL_CATEGORIES = [
  "Audiovisuel",
  "Bureau / Fournitures",
  "Communication / Impression",
  "Cuisine / Restauration",
  "Décoration / Scénographie",
  "Éclairage",
  "Électronique",
  "Événementiel",
  "Informatique",
  "Jeux / Loisirs",
  "Livres / Documentation",
  "Mobilier",
  "Musique / Instruments",
  "Outillage",
  "Sécurité / Premiers secours",
  "Sonorisation",
  "Sport",
  "Textile / Costumes",
  "Véhicule",
  "Autre",
] as const

const CATEGORY_OPTIONS = [
  { value: "", label: "— Aucune —" },
  ...MATERIAL_CATEGORIES.map(c => ({ value: c, label: c })),
]

interface Props {
  open:         boolean
  onOpenChange: (open: boolean) => void
  material?:    Material | null
}

export function MaterialModal({ open, onOpenChange, material }: Props) {
  const isEditing = !!material
  const createMut = useCreateMaterial()
  const updateMut = useUpdateMaterial(material?.id ?? "")

  const { register, handleSubmit, reset, control, formState: { errors, isSubmitting } } = useForm<FormValues>({
    resolver:      zodResolver(schema),
    defaultValues: { name: "", quantity: 1, status: "DISPONIBLE" },
  })

  useEffect(() => {
    if (!open) return
    reset(material ? {
      name:          material.name,
      category:      material.category ?? "",
      description:   material.description ?? "",
      serialNumber:  material.serialNumber ?? "",
      quantity:      material.quantity,
      status:        material.status,
      location:      material.location ?? "",
      purchaseDate:  material.purchaseDate ? material.purchaseDate.slice(0, 10) : "",
      purchasePrice: material.purchasePrice ? String(material.purchasePrice) : "",
      notes:         material.notes ?? "",
    } : { name: "", quantity: 1, status: "DISPONIBLE", category: "", description: "", serialNumber: "", location: "", purchaseDate: "", purchasePrice: "", notes: "" })
  }, [open, material, reset])

  async function onSubmit(values: FormValues) {
    const payload: MaterialInput = {
      name:          values.name,
      category:      values.category || null,
      description:   values.description || null,
      serialNumber:  values.serialNumber || null,
      quantity:      values.quantity,
      status:        values.status as MaterialStatus,
      location:      values.location || null,
      purchaseDate:  values.purchaseDate || null,
      purchasePrice: values.purchasePrice ? parseFloat(values.purchasePrice) : null,
      notes:         values.notes || null,
    }
    try {
      if (isEditing) {
        await updateMut.mutateAsync(payload)
        toast.success("Article mis à jour")
      } else {
        await createMut.mutateAsync(payload)
        toast.success("Article créé")
      }
      onOpenChange(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur")
    }
  }

  const isPending = isSubmitting || createMut.isPending || updateMut.isPending

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={isEditing ? "Modifier l'article" : "Nouvel article"} size="lg">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <FormField label="Nom" required placeholder="MacBook Pro 2023" error={errors.name?.message} {...register("name")} />

        <div className="grid grid-cols-2 gap-3">
          <Controller
            name="category"
            control={control}
            render={({ field }) => (
              <SelectField
                label="Catégorie"
                options={CATEGORY_OPTIONS}
                value={field.value ?? ""}
                onValueChange={field.onChange}
                placeholder="— Aucune —"
              />
            )}
          />

          <Controller
            name="status"
            control={control}
            render={({ field }) => (
              <SelectField label="Statut" options={STATUS_OPTIONS} value={field.value} onValueChange={field.onChange} />
            )}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Quantité" type="number" min={1} error={errors.quantity?.message} {...register("quantity", { valueAsNumber: true })} />
          <FormField label="Emplacement" placeholder="Salle A, Local…" {...register("location")} />
        </div>

        <FormField label="Numéro de série / référence" placeholder="SN-12345" {...register("serialNumber")} />

        <FormField label="Description" placeholder="Description courte…" {...register("description")} />

        <div className="grid grid-cols-2 gap-3">
          <FormField label="Date d'achat" type="date" {...register("purchaseDate")} />
          <FormField label="Prix d'achat (€)" type="number" step="0.01" min={0} placeholder="0.00" {...register("purchasePrice")} />
        </div>

        <FormField label="Notes" placeholder="Remarques internes…" {...register("notes")} />

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>Annuler</Button>
          <Button type="submit" loading={isPending}>{isEditing ? "Enregistrer" : "Créer"}</Button>
        </div>
      </form>
    </Modal>
  )
}
