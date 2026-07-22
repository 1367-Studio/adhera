"use client"

import { useState, useEffect } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { toast } from "sonner"
import { VideoCameraIcon, CalendarBlankIcon, PlayIcon, ClockIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { MeetingRoom } from "@/components/reunions/meeting-room"
import { useMeetingEndedListener, useMeetingCreatedListener } from "@/hooks/use-meetings"

type Meeting = {
  id:          string
  title:       string
  description: string | null
  status:      "SCHEDULED" | "LIVE" | "ENDED"
  type:        "AG" | "BUREAU" | "GENERALE"
  scheduledAt: string | null
  startedAt:   string | null
  endedAt:     string | null
  roomName:    string
  summary:     string | null
}

const STATUS_LABELS = { SCHEDULED: "Planifiée", LIVE: "En cours", ENDED: "Terminée" }
const STATUS_VARIANTS = { SCHEDULED: "secondary", LIVE: "default", ENDED: "outline" } as const

export default function ReunionsPortalPage() {
  const qc = useQueryClient()
  const [activeMeetingId, setActiveMeetingId] = useState<string | null>(null)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)

  const { data: meetings = [], isLoading, isFetching, isError } = useQuery<Meeting[]>({
    queryKey: ["portal-meetings"],
    queryFn:  () => fetch("/api/portal/meetings").then(r => r.json()),
    staleTime: 0,
  })

  // Cross-tab: an admin ending this meeting elsewhere, or the LiveKit webhook auto-closing
  // it, should refresh this list immediately too.
  useMeetingEndedListener(() => qc.invalidateQueries({ queryKey: ["portal-meetings"] }))

  // Cross-tab: an admin creating a meeting (instant or scheduled) should show up on this
  // list immediately, without waiting for a remount. The broadcast goes to the whole
  // association, not just invited members, so only toast once the refetched list confirms
  // this member is actually a participant — otherwise we'd leak a private meeting's title
  // to members who weren't invited.
  useMeetingCreatedListener(async (data) => {
    await qc.invalidateQueries({ queryKey: ["portal-meetings"] })
    if (data.status !== "LIVE") return
    const list = qc.getQueryData<Meeting[]>(["portal-meetings"]) ?? []
    if (list.some(m => m.id === data.meetingId)) {
      toast.info(`${data.title} — réunion en cours`, { description: "Rejoignez maintenant." })
    }
  })

  // After leaving the call, the meeting's status may have just flipped (ended by an
  // admin or by the LiveKit webhook) — keep the join button in a loading state until the
  // invalidated query settles, instead of flashing a stale "Rejoindre".
  useEffect(() => {
    if (refreshingId && !isFetching) {
      if (isError) toast.error("Impossible d'actualiser le statut de la réunion.")
      setRefreshingId(null)
    }
  }, [isFetching, isError, refreshingId])

  // Failsafe: never leave the join button stuck disabled if the refetch never settles.
  useEffect(() => {
    if (!refreshingId) return
    const t = setTimeout(() => setRefreshingId(null), 8000)
    return () => clearTimeout(t)
  }, [refreshingId])

  function handleLeave(opts?: { ended?: boolean }) {
    if (opts?.ended) {
      setRefreshingId(activeMeetingId)
      qc.invalidateQueries({ queryKey: ["portal-meetings"] })
    }
    setActiveMeetingId(null)
  }

  if (activeMeetingId) {
    const meeting = meetings.find(m => m.id === activeMeetingId)
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{meeting?.title ?? "Réunion"}</h2>
          <Button variant="outline" size="sm" onClick={() => handleLeave()}>
            Quitter
          </Button>
        </div>
        <MeetingRoom meetingId={activeMeetingId} onLeave={handleLeave} tokenEndpoint="/api/portal/meetings/token" />
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
          <VideoCameraIcon className="size-10 text-muted-foreground/50 mx-auto" />
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
                        <CalendarBlankIcon className="size-3" />
                        {format(new Date(meeting.scheduledAt), "d MMM yyyy 'à' HH'h'mm", { locale: fr })}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => setActiveMeetingId(meeting.id)}
                    loading={meeting.id === refreshingId}
                    disabled={meeting.id === refreshingId}
                  >
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
                  {meeting.summary && (
                    <div className="mt-3 rounded-lg border bg-muted/30 p-3 text-sm whitespace-pre-wrap leading-relaxed">
                      {meeting.summary}
                    </div>
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
