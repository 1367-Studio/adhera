"use client"

import { useEffect, useState } from "react"
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { PlusIcon, TrashIcon } from "@phosphor-icons/react/dist/ssr"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { Input } from "@/components/ui/input"
import { TextareaField } from "@/components/ui/textarea-field"
import { SelectField } from "@/components/ui/select-field"
import { DateField } from "@/components/ui/date-field"
import { TacheAssigneesField } from "@/components/taches/tache-assignees-field"
import { GererCategoriesPopover } from "@/components/taches/gerer-categories-popover"
import { tacheSchema, type TacheInput, type TacheReminderInput } from "@/lib/schemas"
import { useTacheCategories, useCreateTacheCategorie, type Tache } from "@/hooks/use-taches"

// Choisit un offset qui n'existe pas encore parmi les rappels déjà présents, pour qu'un clic
// répété sur "+ Ajouter un rappel" ne crée jamais silencieusement un doublon rejeté par la
// contrainte unique (offsetDays, direction) — voir tacheSchema.refine.
function nextReminderDefault(existing: TacheReminderInput[]): TacheReminderInput {
  const taken = new Set(existing.filter(r => r.direction === "AVANT").map(r => r.offsetDays))
  let offsetDays = 2
  while (taken.has(offsetDays)) offsetDays += 1
  return { offsetDays, direction: "AVANT" }
}

interface Props {
  open:          boolean
  onOpenChange:  (open: boolean) => void
  editing?:      Tache | null
  // Pré-remplissage depuis le panneau "Actions à faire" du tableau de bord (FORM-119).
  prefill?:      Partial<TacheInput>
  onSubmit:      (data: TacheInput) => Promise<void>
  loading?:      boolean
}

export function NouvelleTacheSheet({ open, onOpenChange, editing, prefill, onSubmit, loading }: Props) {
  const t = useTranslations("taches.form")
  const tCommon = useTranslations("common")
  const { data: categories = [] } = useTacheCategories()
  const createCategorie = useCreateTacheCategorie()
  const [newCategorieOpen, setNewCategorieOpen] = useState(false)
  const [newCategorieName, setNewCategorieName] = useState("")

  const { register, handleSubmit, control, setValue, reset, formState: { errors } } = useForm<TacheInput>({
    resolver: zodResolver(tacheSchema),
    defaultValues: {
      titre: "", description: "", categorieId: null, assigneeIds: [], dueDate: "", reminders: [],
      ...prefill,
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: "reminders" })
  const dueDate   = useWatch({ control, name: "dueDate" })
  const reminders = useWatch({ control, name: "reminders" }) ?? []

  useEffect(() => {
    if (!open) return
    reset({
      titre:         editing?.titre ?? "",
      description:   editing?.description ?? "",
      categorieId:   editing?.categorieId ?? null,
      assigneeIds:   editing?.assignees.map(a => a.membreId) ?? [],
      dueDate:       editing?.dueDate ? editing.dueDate.slice(0, 10) : "",
      reminders:     editing?.reminders.map(r => ({ offsetDays: r.offsetDays, direction: r.direction })) ?? [],
      linkBackHref:  editing?.linkBackHref ?? null,
      linkBackLabel: editing?.linkBackLabel ?? null,
      ...(!editing ? prefill : {}),
    })
    // L'état du mini-formulaire "nouvelle catégorie" ne fait pas partie du form react-hook-
    // form ci-dessus — sans ce reset explicite, le rouvrir laissait apparaître le texte
    // encore tapé lors d'une ouverture précédente, même pour une tâche différente.
    setNewCategorieOpen(false)
    setNewCategorieName("")
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing])

  // Effacer l'échéance invalide tout rappel existant (miroir du comportement serveur côté
  // PATCH) — évite d'envoyer un formulaire dont le refine rejettera la combinaison, et évite
  // de laisser des rappels affichés qui n'ont plus d'échéance sur laquelle se caler.
  function handleDueDateChange(value: string) {
    setValue("dueDate", value, { shouldValidate: true })
    if (!value && reminders.length > 0) setValue("reminders", [], { shouldValidate: false })
  }

  async function handleCreateCategorie() {
    if (!newCategorieName.trim()) return
    try {
      const categorie = await createCategorie.mutateAsync({ nom: newCategorieName.trim() })
      setValue("categorieId", categorie.id, { shouldValidate: false })
      setNewCategorieName("")
      setNewCategorieOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tCommon("error"))
    }
  }

  const categorieOptions = [
    { value: "", label: t("noCategorie") },
    ...categories.map(c => ({ value: c.id, label: c.nom })),
  ]

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col gap-0 p-0 overflow-hidden">
        <SheetHeader className="px-5 pt-10 pb-4 border-b shrink-0">
          <SheetTitle className="text-base font-semibold">
            {editing ? t("editTitle") : t("createTitle")}
          </SheetTitle>
        </SheetHeader>

        <form
          id="tache-form"
          onSubmit={handleSubmit(async data => { await onSubmit(data) })}
          className="flex-1 overflow-y-auto px-5 py-4 space-y-4"
          noValidate
        >
          <FormField label={t("titre")} required {...register("titre")} error={errors.titre?.message} />

          <TextareaField label={t("description")} rows={3} {...register("description")} error={errors.description?.message} />

          <div className="space-y-1.5">
            <Controller
              name="categorieId"
              control={control}
              render={({ field }) => (
                <SelectField
                  label={t("categorie")}
                  options={categorieOptions}
                  value={field.value ?? ""}
                  onValueChange={v => field.onChange(v || null)}
                />
              )}
            />
            {newCategorieOpen ? (
              <div className="flex items-center gap-2">
                <Input
                  placeholder={t("newCategoriePlaceholder")}
                  value={newCategorieName}
                  onChange={e => setNewCategorieName(e.target.value)}
                  className="flex-1"
                />
                <Button type="button" onClick={handleCreateCategorie} loading={createCategorie.isPending}>{tCommon("add")}</Button>
                <Button type="button" variant="ghost" onClick={() => setNewCategorieOpen(false)}>{tCommon("cancel")}</Button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setNewCategorieOpen(true)} className="text-xs text-primary hover:underline">
                  {t("newCategorie")}
                </button>
                {categories.length > 0 && <GererCategoriesPopover />}
              </div>
            )}
          </div>

          <Controller
            name="assigneeIds"
            control={control}
            render={({ field }) => (
              <TacheAssigneesField value={field.value ?? []} onChange={field.onChange} />
            )}
          />

          <Controller
            name="dueDate"
            control={control}
            render={({ field }) => (
              <DateField
                label={t("echeance")}
                allowFuture
                hint={t("echeanceHint")}
                value={field.value}
                onChange={handleDueDateChange}
                error={errors.dueDate?.message}
              />
            )}
          />

          <div className="space-y-2">
            <p className="text-sm font-medium">{t("rappels")}</p>
            {!dueDate ? (
              <p className="text-xs text-muted-foreground">{t("rappelsNeedEcheance")}</p>
            ) : (
              <>
                {fields.length === 0 && (
                  <p className="text-xs text-muted-foreground">{t("noRappels")}</p>
                )}
                {fields.map((field, index) => (
                  <div key={field.id} className="flex items-end gap-2">
                    <div className="flex-1">
                      <FormField
                        label={t("rappelOffset")}
                        type="number"
                        min={1}
                        {...register(`reminders.${index}.offsetDays`, { valueAsNumber: true })}
                      />
                    </div>
                    <div className="flex-1">
                      <Controller
                        name={`reminders.${index}.direction`}
                        control={control}
                        render={({ field }) => (
                          <SelectField
                            label={t("rappelDirection")}
                            value={field.value}
                            onValueChange={field.onChange}
                            options={[
                              { value: "AVANT", label: t("rappelAvant") },
                              { value: "APRES", label: t("rappelApres") },
                            ]}
                          />
                        )}
                      />
                    </div>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => remove(index)}>
                      <TrashIcon className="size-3.5" />
                    </Button>
                  </div>
                ))}
                {errors.reminders?.message && (
                  <p className="text-xs text-destructive">{errors.reminders.message}</p>
                )}
                <Button type="button" variant="outline" size="sm" onClick={() => append(nextReminderDefault(reminders))}>
                  <PlusIcon className="size-3.5" />
                  {t("ajouterRappel")}
                </Button>
              </>
            )}
          </div>
        </form>

        <div className="flex items-center justify-end gap-2 p-4 border-t shrink-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>{tCommon("cancel")}</Button>
          <Button type="submit" form="tache-form" loading={loading}>
            {editing ? tCommon("save") : t("createTache")}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
