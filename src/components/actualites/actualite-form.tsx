"use client"

import { useForm, Controller } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { MagnifyingGlassIcon, CheckIcon, UsersIcon } from "@phosphor-icons/react/dist/ssr";
import { actualiteSchema, type ActualiteInput } from "@/lib/schemas"
import { FormField } from "@/components/ui/form-field"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { SelectField } from "@/components/ui/select-field"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { ImageUpload } from "@/components/ui/image-upload"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface ActualiteFormProps {
  defaultValues?: Partial<ActualiteInput>
  onSubmit: (data: ActualiteInput) => Promise<void>
  onCancel: () => void
  loading?: boolean
}

type Evenement = { id: string; title: string }
type Membre    = { id: string; firstName: string; lastName: string; email: string | null }

export function ActualiteForm({ defaultValues, onSubmit, onCancel, loading }: ActualiteFormProps) {
  const { register, handleSubmit, control, watch, setValue, formState: { errors } } = useForm<ActualiteInput>({
    resolver: zodResolver(actualiteSchema),
    defaultValues: {
      pinned: false,
      imageUrl: "",
      recipientMode: "ALL",
      recipientIds: [],
      ...defaultValues,
    },
    mode: "onSubmit",
  })

  const recipientMode = watch("recipientMode")
  const recipientIds  = watch("recipientIds") ?? []

  const [memberSearch, setMemberSearch] = useState("")

  const { data: evenementsRaw = [] } = useQuery<Evenement[]>({
    queryKey: ["evenements", "all"],
    queryFn: async () => {
      const res = await fetch("/api/evenements")
      if (!res.ok) return []
      return res.json()
    },
  })

  const { data: membres = [] } = useQuery<Membre[]>({
    queryKey: ["membres", "all"],
    queryFn: async () => {
      const res = await fetch("/api/membres")
      if (!res.ok) return []
      return res.json()
    },
    enabled: recipientMode === "SELECTED",
  })

  const filteredMembres = membres.filter(m => {
    if (!memberSearch) return true
    const q = memberSearch.toLowerCase()
    return (
      m.firstName.toLowerCase().includes(q) ||
      m.lastName.toLowerCase().includes(q)  ||
      (m.email ?? "").toLowerCase().includes(q)
    )
  })

  function toggleMembre(id: string) {
    const next = recipientIds.includes(id)
      ? recipientIds.filter(x => x !== id)
      : [...recipientIds, id]
    setValue("recipientIds", next, { shouldValidate: false })
  }

  const evenementOptions = [
    { value: "", label: "Aucun événement lié" },
    ...evenementsRaw.map(e => ({ value: e.id, label: e.title })),
  ]

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      {/* Image — full-width at top for a social post feel */}
      <Controller
        name="imageUrl"
        control={control}
        render={({ field }) => (
          <div className="space-y-1.5">
            <Label>Image de couverture</Label>
            <ImageUpload
              value={field.value ?? ""}
              onChange={field.onChange}
              prefix="adhera/actualites"
              aspectRatio="video"
            />
          </div>
        )}
      />

      <FormField
        label="Titre"
        required
        placeholder="Titre de l'actualité…"
        error={errors.title?.message}
        {...register("title")}
      />

      <Controller
        name="content"
        control={control}
        render={({ field }) => (
          <RichTextEditor
            label="Contenu"
            required
            value={field.value ?? ""}
            onChange={field.onChange}
            placeholder="Rédigez votre actualité…"
            minHeight="180px"
            error={errors.content?.message}
          />
        )}
      />

      <div className="grid grid-cols-2 gap-4">
        <Controller
          name="evenementId"
          control={control}
          render={({ field }) => (
            <SelectField
              label="Événement associé"
              options={evenementOptions}
              value={field.value ?? ""}
              onValueChange={field.onChange}
              placeholder="Aucun"
              error={errors.evenementId?.message}
            />
          )}
        />
        <div className="flex items-end pb-1">
          <CheckboxField
            label="Épingler en tête de fil"
            {...register("pinned")}
          />
        </div>
      </div>

      {/* Recipients */}
      <div className="space-y-3">
        <Label>Destinataires</Label>

        {/* Toggle */}
        <div className="inline-flex rounded-lg border bg-muted/30 p-0.5 gap-0.5">
          {(["ALL", "SELECTED"] as const).map(mode => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                setValue("recipientMode", mode, { shouldValidate: false })
                if (mode === "ALL") setValue("recipientIds", [], { shouldValidate: false })
              }}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-all",
                recipientMode === mode
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {mode === "ALL" ? "Tous les membres" : "Sélection"}
            </button>
          ))}
        </div>

        {/* Member picker (only when SELECTED) */}
        {recipientMode === "SELECTED" && (
          <div className="rounded-lg border bg-muted/10 overflow-hidden">
            {/* Search */}
            <div className="relative border-b">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                placeholder="Rechercher un membre…"
                value={memberSearch}
                onChange={e => setMemberSearch(e.target.value)}
                className="w-full bg-transparent pl-8 pr-3 py-2 text-sm outline-none"
              />
            </div>

            {/* ListIcon */}
            <div className="max-h-48 overflow-y-auto divide-y">
              {filteredMembres.length === 0 ? (
                <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground text-sm">
                  <UsersIcon className="size-4" />
                  {membres.length === 0 ? "Chargement…" : "Aucun résultat"}
                </div>
              ) : (
                filteredMembres.map(m => {
                  const checked = recipientIds.includes(m.id)
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => toggleMembre(m.id)}
                      className={cn(
                        "w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40",
                        checked && "bg-primary/5",
                      )}
                    >
                      <div className={cn(
                        "size-4 rounded shrink-0 border flex items-center justify-center transition-colors",
                        checked ? "bg-primary border-primary" : "border-input",
                      )}>
                        {checked && <CheckIcon className="size-2.5 text-primary-foreground" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium truncate">{m.firstName} {m.lastName}</p>
                        {m.email && <p className="text-xs text-muted-foreground truncate">{m.email}</p>}
                      </div>
                    </button>
                  )
                })
              )}
            </div>

            {/* Count */}
            {recipientIds.length > 0 && (
              <div className="border-t px-3 py-2 bg-muted/20 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {recipientIds.length} membre{recipientIds.length > 1 ? "s" : ""} sélectionné{recipientIds.length > 1 ? "s" : ""}
                </span>
                <button
                  type="button"
                  onClick={() => setValue("recipientIds", [], { shouldValidate: false })}
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                >
                  Tout désélectionner
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-1">
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
