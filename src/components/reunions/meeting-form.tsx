"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { SelectField } from "@/components/ui/select-field"
import { useMembreTypes } from "@/hooks/use-membre-types"
import { VideoCameraIcon, CalendarBlankIcon } from "@phosphor-icons/react/dist/ssr";

type Membre = { id: string; firstName: string; lastName: string; status: string; typeId: string | null }

const TYPE_OPTIONS = [
  { value: "GENERALE", label: "Réunion générale" },
  { value: "AG",       label: "Assemblée générale" },
  { value: "BUREAU",   label: "Réunion de bureau" },
]

// Sentinel rather than "" for "no filter" — SelectField/Select never let you click back to
// an empty value once a real option has been picked, since no SelectItem carries value="".
const ALL = "__all__"

const STATUS_FILTER_OPTIONS = [
  { value: ALL,        label: "Tous les statuts" },
  { value: "ACTIF",    label: "Actifs" },
  { value: "PENDING",  label: "En attente" },
  { value: "INACTIF",  label: "Inactifs" },
  { value: "SUSPENDU", label: "Suspendus" },
]

export type MeetingFormValues = {
  title: string
  description?: string
  type?: "AG" | "BUREAU" | "GENERALE"
  scheduledAt?: string
  participantIds?: string[]
  instant?: boolean
}

type Props = {
  membres: Membre[]
  loading: boolean
  onSubmit: (data: MeetingFormValues) => void
  onCancel: () => void
  defaultValues?: Partial<MeetingFormValues>
  isEdit?: boolean
}

export function MeetingForm({ membres, loading, onSubmit, onCancel, defaultValues, isEdit }: Props) {
  const { data: membreTypes = [] } = useMembreTypes()

  const [title, setTitle] = useState(defaultValues?.title ?? "")
  const [description, setDescription] = useState(defaultValues?.description ?? "")
  const [type, setType] = useState<"AG" | "BUREAU" | "GENERALE">(defaultValues?.type ?? "GENERALE")
  const [scheduledAt, setScheduledAt] = useState(defaultValues?.scheduledAt ?? "")
  const [selectedIds, setSelectedIds] = useState<string[]>(defaultValues?.participantIds ?? [])
  const [instant, setInstant] = useState(defaultValues?.instant ?? false)
  const [statusFilter, setStatusFilter] = useState(ALL)
  const [typeFilter, setTypeFilter] = useState(ALL)

  function toggleMembre(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const filteredMembres = membres.filter((m) =>
    (statusFilter === ALL || m.status === statusFilter) && (typeFilter === ALL || m.typeId === typeFilter)
  )
  const filteredSelectedCount = filteredMembres.filter((m) => selectedIds.includes(m.id)).length

  function selectAllFiltered() {
    const filteredIds = filteredMembres.map((m) => m.id)
    setSelectedIds((prev) => Array.from(new Set([...prev, ...filteredIds])))
  }

  function deselectAllFiltered() {
    const filteredIds = new Set(filteredMembres.map((m) => m.id))
    setSelectedIds((prev) => prev.filter((id) => !filteredIds.has(id)))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    onSubmit({
      title: title.trim(),
      // In edit mode an empty value must still be sent (as "") so the PATCH route applies
      // it as "clear this field" — omitting it (undefined) means "leave unchanged" there,
      // which would make it impossible to unset a description/date that was set before.
      description: description.trim() || (isEdit ? "" : undefined),
      type,
      scheduledAt: instant ? undefined : scheduledAt || (isEdit ? "" : undefined),
      participantIds: selectedIds,
      instant,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <FormField
        label="Titre"
        required
        id="title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Ex: Réunion du bureau"
      />

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Ordre du jour, informations…"
          rows={3}
        />
      </div>

      <SelectField
        label="Type de réunion"
        options={TYPE_OPTIONS}
        value={type}
        onValueChange={(v) => setType(v as "AG" | "BUREAU" | "GENERALE")}
      />

      {!isEdit && (
        <CheckboxField
          label="Démarrer immédiatement"
          checked={instant}
          onChange={(e) => setInstant(e.target.checked)}
        />
      )}

      {!instant && (
        <FormField
          label="Date et heure planifiée"
          id="scheduledAt"
          type="datetime-local"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
        />
      )}

      {membres.length > 0 && (
        <div className="flex flex-col gap-2">
          <Label>Participants</Label>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex gap-1.5">
              <SelectField
                label="Filtrer par statut"
                options={STATUS_FILTER_OPTIONS}
                value={statusFilter}
                onValueChange={setStatusFilter}
              />
            </div>
            <div className="flex gap-1.5">
              <SelectField
                label="Filtrer par groupe"
                options={[{ value: ALL, label: "Tous les groupes" }, ...membreTypes.map((t) => ({ value: t.id, label: t.name }))]}
                value={typeFilter}
                onValueChange={setTypeFilter}
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" className="flex-1" onClick={selectAllFiltered} disabled={filteredMembres.length === 0}>
              Sélectionner ({filteredMembres.length})
            </Button>
            <Button type="button" variant="outline" size="sm" className="flex-1" onClick={deselectAllFiltered} disabled={filteredSelectedCount === 0}>
              Désélectionner ({filteredSelectedCount})
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">
            {selectedIds.length} membre{selectedIds.length !== 1 ? "s" : ""} sélectionné{selectedIds.length !== 1 ? "s" : ""} au total
          </p>

          <div className="max-h-40 overflow-y-auto rounded-md border p-2 flex flex-col gap-1">
            {filteredMembres.length === 0 ? (
              <p className="text-xs text-muted-foreground p-2">Aucun membre ne correspond à ce filtre.</p>
            ) : (
              filteredMembres.map((m) => (
                <CheckboxField
                  key={m.id}
                  label={`${m.firstName} ${m.lastName}`}
                  checked={selectedIds.includes(m.id)}
                  onChange={() => toggleMembre(m.id)}
                />
              ))
            )}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Annuler
        </Button>
        <Button type="submit" disabled={loading || !title.trim()}>
          {isEdit ? (
            "Enregistrer"
          ) : instant ? (
            <>
              <VideoCameraIcon className="mr-2 h-4 w-4" />
              Démarrer
            </>
          ) : (
            <>
              <CalendarBlankIcon className="mr-2 h-4 w-4" />
              Planifier
            </>
          )}
        </Button>
      </div>
    </form>
  )
}
