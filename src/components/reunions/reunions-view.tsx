"use client"

import { useState, useMemo } from "react"
import { toast } from "sonner"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { VideoIcon, PlusIcon, PlayIcon, Trash2Icon, UsersIcon, CalendarIcon, FileTextIcon, ClockIcon } from "lucide-react"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useMeetings, useCreateMeeting, useDeleteMeeting, type Meeting } from "@/hooks/use-meetings"
import { PageHeader } from "@/components/ui/page-header"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { MeetingRoom } from "@/components/reunions/meeting-room"
import { MeetingForm } from "@/components/reunions/meeting-form"
import { Badge } from "@/components/ui/badge"

type Membre = { id: string; firstName: string; lastName: string }

const STATUS_LABELS: Record<Meeting["status"], string> = {
  SCHEDULED: "Planifiée",
  LIVE: "En cours",
  ENDED: "Terminée",
  CANCELLED: "Annulée",
}

const STATUS_VARIANTS: Record<Meeting["status"], "default" | "secondary" | "destructive" | "outline"> = {
  SCHEDULED: "secondary",
  LIVE: "default",
  ENDED: "outline",
  CANCELLED: "destructive",
}

export function ReunionsView() {
  const { data: meetings = [], isLoading } = useMeetings()
  const createMeeting = useCreateMeeting()
  const deleteMeeting = useDeleteMeeting()

  const [formOpen, setFormOpen] = useState(false)
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const { data: membres = [] } = useQuery<Membre[]>({
    queryKey: ["membres-select"],
    queryFn: async () => {
      const res = await fetch("/api/membres")
      if (!res.ok) return []
      return res.json()
    },
  })

  async function handleCreate(data: {
    title: string
    description?: string
    scheduledAt?: string
    participantIds?: string[]
    instant?: boolean
  }) {
    try {
      const meeting = await createMeeting.mutateAsync(data)
      toast.success(data.instant ? "Réunion démarrée" : "Réunion planifiée")
      setFormOpen(false)
      if (data.instant) setActiveMeetingId(meeting.id)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erreur")
    }
  }

  async function handleDelete() {
    if (!deleteId) return
    try {
      await deleteMeeting.mutateAsync(deleteId)
      toast.success("Réunion supprimée")
      setDeleteId(null)
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Erreur")
    }
  }

  if (activeMeetingId) {
    return (
      <div className="flex flex-col gap-4 p-6">
        <h2 className="text-lg font-semibold">
          {meetings.find((m) => m.id === activeMeetingId)?.title ?? "Réunion"}
        </h2>
        <MeetingRoom
          meetingId={activeMeetingId}
          onLeave={() => setActiveMeetingId(null)}
          isAdmin
        />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <PageHeader
        title="Réunions"
        description="Organisez des réunions vidéo avec vos membres"
        action={
          <Button onClick={() => setFormOpen(true)}>
            <PlusIcon className="mr-2 h-4 w-4" />
            Nouvelle réunion
          </Button>
        }
      />

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Chargement…</div>
      ) : meetings.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-16 text-center">
          <VideoIcon className="h-10 w-10 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Aucune réunion pour le moment</p>
          <Button variant="outline" onClick={() => setFormOpen(true)}>
            <PlusIcon className="mr-2 h-4 w-4" />
            Créer une réunion
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {meetings.map((meeting) => (
            <MeetingCard
              key={meeting.id}
              meeting={meeting}
              onJoin={() => setActiveMeetingId(meeting.id)}
              onDelete={() => setDeleteId(meeting.id)}
            />
          ))}
        </div>
      )}

      <Modal open={formOpen} onOpenChange={setFormOpen} title="Nouvelle réunion">
        <MeetingForm
          membres={membres}
          loading={createMeeting.isPending}
          onSubmit={handleCreate}
          onCancel={() => setFormOpen(false)}
        />
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onOpenChange={(o) => { if (!o) setDeleteId(null) }}
        onConfirm={handleDelete}
        title="Supprimer la réunion ?"
        description="Cette action est irréversible."
        loading={deleteMeeting.isPending}
      />
    </div>
  )
}

function MeetingCard({
  meeting,
  onJoin,
  onDelete,
}: {
  meeting: Meeting
  onJoin: () => void
  onDelete: () => void
}) {
  const router     = useRouter()
  const [now]      = useState(Date.now)
  const canJoin    = meeting.status === "SCHEDULED" || meeting.status === "LIVE"

  const dateDisplay = (() => {
    if (meeting.startedAt) {
      return { icon: <PlayIcon className="h-3 w-3" />, label: format(new Date(meeting.startedAt), "d MMM yyyy à HH:mm", { locale: fr }) }
    }
    const anchor = meeting.scheduledAt ?? meeting.createdAt
    return { icon: <CalendarIcon className="h-3 w-3" />, label: format(new Date(anchor), "d MMM yyyy à HH:mm", { locale: fr }) }
  })()

  const durationLabel = useMemo(() => {
    if (meeting.startedAt && meeting.endedAt) {
      const mins = Math.round((new Date(meeting.endedAt).getTime() - new Date(meeting.startedAt).getTime()) / 60000)
      return mins < 1 ? "< 1 min" : `${mins} min`
    }
    if (meeting.status === "LIVE" && meeting.startedAt) {
      const mins = Math.round((now - new Date(meeting.startedAt).getTime()) / 60000)
      return `En cours depuis ${mins < 1 ? "< 1" : mins} min`
    }
    return null
  }, [meeting.startedAt, meeting.endedAt, meeting.status, now])

  return (
    <div className="rounded-lg border bg-card p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1 min-w-0">
          <p className="font-medium truncate">{meeting.title}</p>
          {meeting.description && (
            <p className="text-xs text-muted-foreground line-clamp-2">{meeting.description}</p>
          )}
        </div>
        <Badge variant={STATUS_VARIANTS[meeting.status]}>{STATUS_LABELS[meeting.status]}</Badge>
      </div>

      <div className="flex flex-col gap-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          {dateDisplay.icon}
          {dateDisplay.label}
        </span>
        {durationLabel && (
          <span className="flex items-center gap-1">
            <ClockIcon className="h-3 w-3" />
            {durationLabel}
          </span>
        )}
        <span className="flex items-center gap-1">
          <UsersIcon className="h-3 w-3" />
          {meeting.participants.length} participant{meeting.participants.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="flex items-center gap-2 pt-1">
        {canJoin && (
          <Button size="sm" onClick={onJoin} className="flex-1">
            <PlayIcon className="mr-1 h-3 w-3" />
            {meeting.status === "LIVE" ? "Rejoindre" : "Démarrer"}
          </Button>
        )}
        {meeting.status === "ENDED" && (
          <Button size="sm" variant="outline" className="flex-1" onClick={() => router.push(`/dashboard/reunions/${meeting.id}`)}>
            <FileTextIcon className="mr-1 h-3 w-3" />
            Transcription
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onDelete} className="text-destructive hover:text-destructive">
          <Trash2Icon className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
