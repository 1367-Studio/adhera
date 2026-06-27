"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { CheckboxField } from "@/components/ui/checkbox-field"
import { VideoIcon, CalendarIcon } from "lucide-react"

type Membre = { id: string; firstName: string; lastName: string }

type Props = {
  membres: Membre[]
  loading: boolean
  onSubmit: (data: {
    title: string
    description?: string
    scheduledAt?: string
    participantIds?: string[]
    instant?: boolean
  }) => void
  onCancel: () => void
}

export function MeetingForm({ membres, loading, onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [scheduledAt, setScheduledAt] = useState("")
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [instant, setInstant] = useState(false)

  function toggleMembre(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    onSubmit({
      title: title.trim(),
      description: description.trim() || undefined,
      scheduledAt: !instant && scheduledAt ? scheduledAt : undefined,
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

      <CheckboxField
        label="Démarrer immédiatement"
        checked={instant}
        onChange={(e) => setInstant(e.target.checked)}
      />

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
        <div className="flex flex-col gap-1.5">
          <Label>Participants</Label>
          <div className="max-h-40 overflow-y-auto rounded-md border p-2 flex flex-col gap-1">
            {membres.map((m) => (
              <CheckboxField
                key={m.id}
                label={`${m.firstName} ${m.lastName}`}
                checked={selectedIds.includes(m.id)}
                onChange={() => toggleMembre(m.id)}
              />
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Annuler
        </Button>
        <Button type="submit" disabled={loading || !title.trim()}>
          {instant ? (
            <>
              <VideoIcon className="mr-2 h-4 w-4" />
              Démarrer
            </>
          ) : (
            <>
              <CalendarIcon className="mr-2 h-4 w-4" />
              Planifier
            </>
          )}
        </Button>
      </div>
    </form>
  )
}
