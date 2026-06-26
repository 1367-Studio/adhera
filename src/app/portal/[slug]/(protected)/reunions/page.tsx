"use client"

import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { VideoIcon, CalendarIcon, PlayIcon, ClockIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { MeetingRoom } from "@/components/reunions/meeting-room"

type Meeting = {
  id:          string
  title:       string
  description: string | null
  status:      "SCHEDULED" | "LIVE" | "ENDED"
  scheduledAt: string | null
  startedAt:   string | null
  endedAt:     string | null
  roomName:    string
}

const STATUS_LABELS = { SCHEDULED: "Planifiée", LIVE: "En cours", ENDED: "Terminée" }
const STATUS_VARIANTS = { SCHEDULED: "secondary", LIVE: "default", ENDED: "outline" } as const

export default function ReunionsPortalPage() {
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null)

  const { data: meetings = [], isLoading } = useQuery<Meeting[]>({
    queryKey: ["portal-meetings"],
    queryFn:  () => fetch("/api/portal/meetings").then(r => r.json()),
  })

  if (activeMeetingId) {
    const meeting = meetings.find(m => m.id === activeMeetingId)
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{meeting?.title ?? "Réunion"}</h2>
          <Button variant="outline" size="sm" onClick={() => setActiveMeetingId(null)}>
            Quitter
          </Button>
        </div>
        <MeetingRoom meetingId={activeMeetingId} onLeave={() => setActiveMeetingId(null)} tokenEndpoint="/api/portal/meetings/token" />
      </div>
    )
  }

  const active = meetings.filter(m => m.status !== "ENDED")
  const ended  = meetings.filter(m => m.status === "ENDED")

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Réunions</h1>
        <p className="text-muted-foreground text-sm mt-1">Vos réunions en cours et à venir.</p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1].map(i => (
            <div key={i} className="rounded-2xl border p-5 animate-pulse space-y-2">
              <div className="h-4 w-48 bg-muted rounded" />
              <div className="h-3 w-32 bg-muted rounded" />
            </div>
          ))}
        </div>
      ) : active.length === 0 && ended.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-12 text-center space-y-3">
          <VideoIcon className="size-10 text-muted-foreground/50 mx-auto" />
          <p className="text-sm text-muted-foreground">Aucune réunion planifiée pour le moment.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {active.length > 0 && (
            <div className="space-y-3">
              {active.map(meeting => (
                <div key={meeting.id} className="rounded-2xl border bg-card p-5 flex items-center gap-4">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{meeting.title}</span>
                      <Badge variant={STATUS_VARIANTS[meeting.status]}>{STATUS_LABELS[meeting.status]}</Badge>
                    </div>
                    {meeting.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{meeting.description}</p>
                    )}
                    {meeting.scheduledAt && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <CalendarIcon className="size-3" />
                        {format(new Date(meeting.scheduledAt), "d MMM yyyy 'à' HH'h'mm", { locale: fr })}
                      </p>
                    )}
                  </div>
                  <Button size="sm" onClick={() => setActiveMeetingId(meeting.id)}>
                    <PlayIcon className="size-4 mr-1.5" />
                    {meeting.status === "LIVE" ? "Rejoindre" : "Démarrer"}
                  </Button>
                </div>
              ))}
            </div>
          )}

          {ended.length > 0 && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-muted-foreground">Historique</p>
              {ended.map(meeting => (
                <div key={meeting.id} className="rounded-2xl border bg-card p-5">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-semibold text-sm">{meeting.title}</span>
                    <Badge variant="outline">Terminée</Badge>
                  </div>
                  {meeting.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2 mb-1">{meeting.description}</p>
                  )}
                  {meeting.endedAt && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <ClockIcon className="size-3" />
                      Terminée le {format(new Date(meeting.endedAt), "d MMM yyyy 'à' HH'h'mm", { locale: fr })}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
