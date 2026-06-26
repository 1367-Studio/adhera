"use client"

import { useState, useEffect, useRef } from "react"
import { useParams, useRouter } from "next/navigation"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { toast } from "sonner"
import {
  ArrowLeftIcon, UsersIcon, CalendarIcon, ClockIcon,
  SparklesIcon, SaveIcon, VideoIcon, PlayIcon,
  FileAudioIcon, Loader2Icon, CircleIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { MeetingRoom } from "@/components/reunions/meeting-room"

type MeetingParticipant = {
  id:     string
  membre: { id: string; firstName: string; lastName: string }
}

type Meeting = {
  id:           string
  title:        string
  description:  string | null
  status:       "SCHEDULED" | "LIVE" | "ENDED" | "CANCELLED"
  scheduledAt:  string | null
  startedAt:    string | null
  endedAt:      string | null
  transcript:   string | null
  summary:      string | null
  egressId:     string | null
  recordingKey: string | null
  createdAt:    string
  participants: MeetingParticipant[]
}

const STATUS_LABELS: Record<Meeting["status"], string> = {
  SCHEDULED: "Planifiée", LIVE: "En cours", ENDED: "Terminée", CANCELLED: "Annulée",
}
const STATUS_VARIANTS: Record<Meeting["status"], "default" | "secondary" | "destructive" | "outline"> = {
  SCHEDULED: "secondary", LIVE: "default", ENDED: "outline", CANCELLED: "destructive",
}

const AUDIO_ACCEPT = ".mp3,.mp4,.mpeg,.mpga,.m4a,.wav,.webm,.ogg,.flac"

export default function ReunionDetailPage() {
  const { id }  = useParams<{ id: string }>()
  const router  = useRouter()
  const qc      = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)

  const [transcript, setTranscript] = useState("")
  const [inRoom,     setInRoom]     = useState(false)

  const { data: meeting, isLoading } = useQuery<Meeting>({
    queryKey: ["meeting", id],
    queryFn:  () => fetch(`/api/meetings/${id}`).then(r => r.json()),
  })

  useEffect(() => {
    if (meeting) setTranscript(meeting.transcript ?? "")
  }, [meeting])

  const saveTranscript = useMutation({
    mutationFn: () =>
      fetch(`/api/meetings/${id}`, {
        method:  "PATCH",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ transcript }),
      }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meeting", id] })
      toast.success("Transcription sauvegardée")
    },
    onError: () => toast.error("Erreur lors de la sauvegarde"),
  })

  const transcribeRecording = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/meetings/${id}/transcribe`, { method: "POST" })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? "Erreur transcription")
      }
      return res.json() as Promise<{ transcript: string }>
    },
    onSuccess: (data) => {
      setTranscript(data.transcript)
      qc.invalidateQueries({ queryKey: ["meeting", id] })
      toast.success("Transcription générée par Whisper")
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur Whisper"),
  })

  const transcribeUpload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData()
      fd.append("audio", file)
      const res = await fetch(`/api/meetings/${id}/transcribe`, {
        method: "POST",
        body:   fd,
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? "Erreur transcription")
      }
      return res.json() as Promise<{ transcript: string }>
    },
    onSuccess: (data) => {
      setTranscript(data.transcript)
      qc.invalidateQueries({ queryKey: ["meeting", id] })
      toast.success("Transcription générée par Whisper")
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur Whisper"),
  })

  const summarize = useMutation({
    mutationFn: async () => {
      if (transcript !== (meeting?.transcript ?? "")) {
        await fetch(`/api/meetings/${id}`, {
          method:  "PATCH",
          headers: { "Content-Type": "application/json" },
          body:    JSON.stringify({ transcript }),
        })
      }
      const res = await fetch(`/api/meetings/${id}/summarize`, { method: "POST" })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error ?? "Erreur IA")
      }
      return res.json() as Promise<{ summary: string }>
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["meeting", id] })
      toast.success("Résumé généré")
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Erreur IA"),
  })

  if (inRoom && meeting) {
    return (
      <div className="space-y-4 p-6">
        <h2 className="text-lg font-semibold">{meeting.title}</h2>
        <MeetingRoom
          meetingId={id}
          onLeave={() => { setInRoom(false); qc.invalidateQueries({ queryKey: ["meeting", id] }) }}
          isAdmin
        />
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <div className="h-8 w-48 bg-muted rounded animate-pulse" />
        <div className="h-40 bg-muted rounded animate-pulse" />
      </div>
    )
  }

  if (!meeting) {
    return <div className="p-6 text-sm text-muted-foreground">Réunion introuvable.</div>
  }

  const transcriptDirty = transcript !== (meeting.transcript ?? "")
  const canJoin         = meeting.status === "SCHEDULED" || meeting.status === "LIVE"
  const isTranscribing  = transcribeRecording.isPending || transcribeUpload.isPending
  const hasRecording    = !!meeting.recordingKey && meeting.status === "ENDED"

  return (
    <div className="flex flex-col gap-6 p-6 h-full">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push("/dashboard/reunions")}>
          <ArrowLeftIcon className="size-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold truncate">{meeting.title}</h1>
            <Badge variant={STATUS_VARIANTS[meeting.status]}>{STATUS_LABELS[meeting.status]}</Badge>
          </div>
          {meeting.description && (
            <p className="text-sm text-muted-foreground mt-0.5">{meeting.description}</p>
          )}
        </div>
        {canJoin && (
          <Button size="sm" onClick={() => setInRoom(true)}>
            <PlayIcon className="size-4 mr-1.5" />
            {meeting.status === "LIVE" ? "Rejoindre" : "Démarrer"}
          </Button>
        )}
      </div>

      {/* Two-column body */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">

        {/* Left — Transcript (2/3) */}
        <div className="lg:col-span-2 space-y-3 flex flex-col">
          <div className="flex items-center justify-between">
            <Label>Transcription</Label>
            <div className="flex items-center gap-2">
              {hasRecording && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => transcribeRecording.mutate()}
                  disabled={isTranscribing}
                >
                  {transcribeRecording.isPending
                    ? <Loader2Icon className="size-3.5 mr-1.5 animate-spin" />
                    : <FileAudioIcon className="size-3.5 mr-1.5" />}
                  {transcribeRecording.isPending ? "Transcription…" : "Transcrire l'enregistrement"}
                </Button>
              )}

              <input
                ref={fileRef}
                type="file"
                accept={AUDIO_ACCEPT}
                className="hidden"
                onChange={e => {
                  const file = e.target.files?.[0]
                  if (file) transcribeUpload.mutate(file)
                  e.target.value = ""
                }}
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => fileRef.current?.click()}
                disabled={isTranscribing}
              >
                {transcribeUpload.isPending
                  ? <Loader2Icon className="size-3.5 mr-1.5 animate-spin" />
                  : <FileAudioIcon className="size-3.5 mr-1.5" />}
                {transcribeUpload.isPending ? "Transcription…" : "Importer un audio"}
              </Button>

              {transcriptDirty && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => saveTranscript.mutate()}
                  loading={saveTranscript.isPending}
                >
                  <SaveIcon className="size-3.5 mr-1.5" />
                  Sauvegarder
                </Button>
              )}
            </div>
          </div>

          {isTranscribing && (
            <div className="rounded-xl border border-dashed p-4 flex items-center gap-3 text-sm text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin shrink-0" />
              Whisper transcrit l'audio… Cela peut prendre quelques instants.
            </div>
          )}

          <Textarea
            value={transcript}
            onChange={e => setTranscript(e.target.value)}
            placeholder="La transcription apparaîtra ici après la réunion. Vous pouvez aussi importer un fichier audio ou saisir le texte manuellement."
            className="font-mono text-xs resize-none flex-1 min-h-[300px]"
          />
          <p className="text-[11px] text-muted-foreground">
            Formats acceptés : MP3, M4A, WAV, WebM, OGG, FLAC · Max 25 Mo · Détection automatique de la langue (français, portugais, anglais…)
          </p>
        </div>

        {/* Right — Meta + AI Summary (1/3) */}
        <div className="space-y-4">

          {/* Meta */}
          <div className="rounded-xl border bg-card p-4 space-y-2 text-sm text-muted-foreground">
            {meeting.scheduledAt && (
              <span className="flex items-center gap-1.5">
                <CalendarIcon className="size-4 shrink-0" />
                Planifiée le {format(new Date(meeting.scheduledAt), "d MMM yyyy 'à' HH'h'mm", { locale: fr })}
              </span>
            )}
            {meeting.startedAt && (
              <span className="flex items-center gap-1.5">
                <VideoIcon className="size-4 shrink-0" />
                Démarrée le {format(new Date(meeting.startedAt), "d MMM yyyy 'à' HH'h'mm", { locale: fr })}
              </span>
            )}
            {meeting.endedAt && (
              <span className="flex items-center gap-1.5">
                <ClockIcon className="size-4 shrink-0" />
                Terminée le {format(new Date(meeting.endedAt), "d MMM yyyy 'à' HH'h'mm", { locale: fr })}
              </span>
            )}
            <span className="flex items-start gap-1.5">
              <UsersIcon className="size-4 shrink-0 mt-0.5" />
              <span>
                {meeting.participants.length} participant{meeting.participants.length !== 1 ? "s" : ""} :{" "}
                {meeting.participants.map(p => `${p.membre.firstName} ${p.membre.lastName}`).join(", ")}
              </span>
            </span>
            {meeting.egressId && (
              <span className="flex items-center gap-1.5 text-red-500">
                <CircleIcon className="size-2 fill-current animate-pulse" />
                Enregistrement en cours
              </span>
            )}
            {hasRecording && (
              <span className="flex items-center gap-1.5 text-green-600">
                <CircleIcon className="size-2 fill-current" />
                Enregistrement disponible
              </span>
            )}
          </div>

          {/* AI Summary */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Compte-rendu IA</Label>
              <Button
                size="sm"
                onClick={() => summarize.mutate()}
                loading={summarize.isPending}
                disabled={!transcript.trim()}
              >
                <SparklesIcon className="size-3.5 mr-1.5" />
                {meeting.summary ? "Regénérer" : "Générer"}
              </Button>
            </div>

            {meeting.summary ? (
              <div className="rounded-xl border bg-muted/30 p-4 text-sm whitespace-pre-wrap leading-relaxed">
                {meeting.summary}
              </div>
            ) : (
              <div className="rounded-xl border border-dashed p-6 text-center">
                <SparklesIcon className="size-7 text-muted-foreground/40 mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">
                  {transcript.trim()
                    ? "Cliquez sur « Générer » pour créer le compte-rendu."
                    : "La transcription est nécessaire pour générer le résumé."}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
