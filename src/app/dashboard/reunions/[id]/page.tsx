"use client"

import { useState, useEffect, useRef } from "react"
import { useParams } from "next/navigation"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { useCurrentUser, useModules, isManager } from "@/lib/user-context"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { toast } from "sonner"
import { UsersIcon, CalendarBlankIcon, ClockIcon, SparkleIcon, FloppyDiskIcon, VideoCameraIcon, PlayIcon, FileAudioIcon, CircleNotchIcon, CircleIcon, DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { MeetingRoom } from "@/components/reunions/meeting-room"
import { useMeetingEndedListener } from "@/hooks/use-meetings"
import { BackLink } from "@/components/ui/back-link"
import { DetailNotFound } from "@/components/ui/detail-not-found"
import { DetailLoadingSkeleton } from "@/components/ui/detail-loading-skeleton"
import { APP_NAME } from "@/config/brand"
import { hexToRgb255, loadLogoForPdf } from "@/lib/pdf/branded-header-client"

type MeetingParticipant = {
  id:     string
  // status is redacted to null by the API for non-managers (see redactParticipantStatus in
  // src/lib/meetings/select.ts) — only managers can see it or export the attendance PDF.
  membre: { id: string; firstName: string; lastName: string; status: "PENDING" | "ACTIF" | "INACTIF" | "SUSPENDU" | null }
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
  const qc      = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const modules = useModules()
  const canManage = isManager(useCurrentUser().role)

  const [transcript, setTranscript] = useState("")
  const [inRoom,     setInRoom]     = useState(false)
  const [awaitingRefresh, setAwaitingRefresh] = useState(false)

  const { data: meeting, isLoading, isFetching, isError } = useQuery<Meeting>({
    queryKey:  ["meeting", id],
    queryFn:   () => fetch(`/api/meetings/${id}`).then(r => r.json()),
    staleTime: 0,
  })

  // Logo/couleur pour le PDF de feuille de présence (handleExportPdf) — même règle
  // Pro-only que les devis/factures, voir canUseCustomBranding() dans src/lib/plan-limits.ts.
  const { data: assoc } = useQuery<{
    name: string
    plan: "ESSENTIAL" | "PRO"
    customBrandingEnabled: boolean | null
    logoUrl: string | null
    primaryColor: string | null
  }>({
    queryKey: ["association"],
    queryFn:  () => fetch("/api/association").then(r => r.json()),
    enabled:  canManage,
  })

  // Cross-tab: this meeting being auto-closed by the LiveKit webhook (or ended from another
  // tab) should refresh this page immediately too.
  useMeetingEndedListener((endedMeetingId) => {
    if (endedMeetingId === id) qc.invalidateQueries({ queryKey: ["meeting", id] })
  })

  // After leaving the call, the meeting's status may have just flipped (ended by us or
  // by the LiveKit webhook) — keep the join button in a loading state until the
  // invalidated query settles, instead of flashing a stale "Rejoindre".
  useEffect(() => {
    if (awaitingRefresh && !isFetching) {
      if (isError) toast.error("Impossible d'actualiser le statut de la réunion.")
      setAwaitingRefresh(false)
    }
  }, [isFetching, isError, awaitingRefresh])

  // Failsafe: never leave the join button stuck disabled if the refetch never settles.
  useEffect(() => {
    if (!awaitingRefresh) return
    const t = setTimeout(() => setAwaitingRefresh(false), 8000)
    return () => clearTimeout(t)
  }, [awaitingRefresh])

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

  async function handleExportPdf() {
    if (!meeting) return
    if (meeting.participants.length === 0) {
      toast.error("Aucun participant à exporter")
      return
    }
    const { default: jsPDF }     = await import("jspdf")
    const { default: autoTable } = await import("jspdf-autotable")

    const doc   = new jsPDF({ unit: "mm", format: "a4" })
    const W     = 210
    const M     = 14
    const ZINC  = [113, 113, 122] as [number, number, number]
    const BLACK = [24,  24,  27 ] as [number, number, number]
    const title = meeting.title
    const today = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })

    const canBrand = assoc ? (assoc.customBrandingEnabled ?? assoc.plan === "PRO") : false
    const headerRgb: [number, number, number] =
      (canBrand && assoc?.primaryColor && hexToRgb255(assoc.primaryColor)) || [0, 0, 0]
    const logo = canBrand && assoc?.logoUrl ? await loadLogoForPdf("/api/association/branding/logo") : null

    // Custom brand colors are freely picked (plain <input type="color">), so a light/pale
    // one would make the fixed white header text unreadable — pick dark text on light fills.
    const [hr, hg, hb] = headerRgb
    const headerLuminance = (hr * 299 + hg * 587 + hb * 114) / 1000
    const headerTextRgb: [number, number, number] = headerLuminance > 150 ? BLACK : [255, 255, 255]

    // ── Header bar ─────────────────────────────────────────────────────────
    const headerH = 30
    doc.setFillColor(...headerRgb)
    doc.rect(0, 0, W, headerH, "F")
    doc.setTextColor(...headerTextRgb)

    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    const rightLabelW = doc.getTextWidth("Feuille de présence")
    // Space left of the right-aligned "Feuille de présence" label — caps both the logo and
    // the fallback name so neither overlaps it (see document-pdf.ts for the same maxW pattern).
    const availW = (W - M) - M - rightLabelW - 6

    doc.setFontSize(10)
    doc.setFont("helvetica", "bold")
    if (logo) {
      const maxLogoH = 20
      const logoH = Math.min(maxLogoH, availW * (logo.height / logo.width))
      const logoW = logo.width * (logoH / logo.height)
      doc.addImage(logo.dataUrl, logo.format, M, (headerH - logoH) / 2, logoW, logoH)
    } else {
      const fullName = (canBrand ? assoc!.name : APP_NAME).toUpperCase()
      let name = fullName
      while (name.length > 1 && doc.getTextWidth(`${name}…`) > availW) name = name.slice(0, -1)
      doc.text(name.length < fullName.length ? `${name}…` : name, M, headerH / 2 + 3)
    }
    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.text("Feuille de présence", W - M, headerH / 2 + 3, { align: "right" })

    // ── Meeting title + meta ─────────────────────────────────────────────────
    let y = headerH + 12
    doc.setTextColor(...BLACK)
    doc.setFontSize(16)
    doc.setFont("helvetica", "bold")
    doc.text(title, M, y)
    y += 7

    doc.setFontSize(8.5)
    doc.setFont("helvetica", "normal")
    doc.setTextColor(...ZINC)
    const meetingDate = meeting.scheduledAt ?? meeting.startedAt
    doc.text(
      meetingDate ? format(new Date(meetingDate), "EEEE dd MMMM yyyy · HH'h'mm", { locale: fr }) : "Date non définie",
      M, y,
    )
    doc.text(`Généré le ${today}`, W - M, y, { align: "right" })
    y += 10

    // ── Separator ───────────────────────────────────────────────────────────
    doc.setDrawColor(228, 228, 231)
    doc.line(M, y, W - M, y)
    y += 5

    // ── Table ───────────────────────────────────────────────────────────────
    autoTable(doc, {
      margin:             { left: M, right: M },
      startY:             y,
      head:               [["#", "Nom", "Prénom", "Adhérent actif", "Signature"]],
      body:               meeting.participants.map((p, i) => [
        i + 1,
        p.membre.lastName,
        p.membre.firstName,
        p.membre.status === "ACTIF" ? "Oui" : "Non",
        "",
      ]),
      headStyles:         { fillColor: headerRgb, textColor: headerTextRgb, fontStyle: "bold" as const, fontSize: 8 },
      bodyStyles:         { fontSize: 8.5, textColor: BLACK, minCellHeight: 12 },
      alternateRowStyles: { fillColor: [250, 250, 250] as [number, number, number] },
      styles:             { cellPadding: 3, lineColor: [228, 228, 231] as [number, number, number], lineWidth: 0.1 },
      columnStyles: {
        0: { cellWidth: 10, halign: "center" },
        3: { cellWidth: 30, halign: "center" },
        4: { cellWidth: 50 },
      },
      didParseCell: (data) => {
        if (data.section !== "body") return
        if (data.column.index === 3) {
          data.cell.styles.textColor = data.cell.raw === "Oui" ? [22, 163, 74] : ZINC
        }
      },
    })

    // ── Per-page footer ─────────────────────────────────────────────────────
    const pageCount = doc.getNumberOfPages()
    for (let p = 1; p <= pageCount; p++) {
      doc.setPage(p)
      doc.setDrawColor(228, 228, 231)
      doc.line(M, 287, W - M, 287)
      doc.setFontSize(7.5)
      doc.setFont("helvetica", "normal")
      doc.setTextColor(...ZINC)
      doc.text(`Page ${p} / ${pageCount}`, M, 292)
      doc.text(`Généré par ${APP_NAME}`, W - M, 292, { align: "right" })
    }

    doc.save(`feuille_presence_${title.replace(/[^a-z0-9]/gi, "_").toLowerCase()}.pdf`)
  }

  if (inRoom && meeting) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">{meeting.title}</h2>
        <MeetingRoom
          meetingId={id}
          onLeave={(opts) => {
            setInRoom(false)
            if (opts?.ended) {
              setAwaitingRefresh(true)
              qc.invalidateQueries({ queryKey: ["meeting", id] })
            }
          }}
          isAdmin
        />
      </div>
    )
  }

  if (isLoading) {
    return <DetailLoadingSkeleton />
  }

  if (!meeting) {
    return (
      <DetailNotFound
        message="Cette réunion est introuvable ou a été supprimée."
        backHref="/dashboard/reunions"
        backLabel="Retour à la liste"
      />
    )
  }

  const transcriptDirty  = transcript !== (meeting.transcript ?? "")
  const canJoin          = (meeting.status === "SCHEDULED" || meeting.status === "LIVE") && modules.reunions
  const isTranscribing   = transcribeRecording.isPending || transcribeUpload.isPending
  const hasRecording     = !!meeting.recordingKey && meeting.status === "ENDED"
  const canTranscribe    = modules.reunions
  const canSummarize     = modules.reunions

  return (
    <div className="flex flex-col gap-6 h-full mt-4">
      {/* Header */}
      <div className="flex items-center gap-3 flex-wrap">
        <BackLink href="/dashboard/reunions" iconOnly>Réunions</BackLink>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold truncate">{meeting.title}</h1>
            <Badge variant={STATUS_VARIANTS[meeting.status]}>{STATUS_LABELS[meeting.status]}</Badge>
          </div>
          {meeting.description && (
            <p className="text-sm text-muted-foreground mt-0.5">{meeting.description}</p>
          )}
        </div>
        {canManage && (
          <Button size="sm" variant="outline" onClick={handleExportPdf}>
            <DownloadSimpleIcon className="size-4 mr-1.5" />
            <span className="hidden sm:inline">Feuille de </span>présence
          </Button>
        )}
        {canJoin && (
          <Button size="sm" onClick={() => setInRoom(true)} loading={awaitingRefresh} disabled={awaitingRefresh}>
            <PlayIcon className="size-4 mr-1.5" />
            {meeting.status === "LIVE" ? "Rejoindre" : "Démarrer"}
          </Button>
        )}
      </div>

      {/* Two-column body */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">

        {/* Left — Transcript (2/3) */}
        <div className="lg:col-span-2 space-y-3 flex flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>Transcription</Label>
            <div className="flex flex-wrap items-center gap-2">
              {canTranscribe && hasRecording && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => transcribeRecording.mutate()}
                  disabled={isTranscribing}
                >
                  {transcribeRecording.isPending
                    ? <CircleNotchIcon className="size-3.5 mr-1.5 animate-spin" />
                    : <FileAudioIcon className="size-3.5 mr-1.5" />}
                  {transcribeRecording.isPending ? "Transcription…" : "Transcrire l'enregistrement"}
                </Button>
              )}

              {canTranscribe && (
                <>
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
                      ? <CircleNotchIcon className="size-3.5 mr-1.5 animate-spin" />
                      : <FileAudioIcon className="size-3.5 mr-1.5" />}
                    {transcribeUpload.isPending ? "Transcription…" : "Importer un audio"}
                  </Button>
                </>
              )}

              {transcriptDirty && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => saveTranscript.mutate()}
                  loading={saveTranscript.isPending}
                >
                  <FloppyDiskIcon className="size-3.5 mr-1.5" />
                  Sauvegarder
                </Button>
              )}
            </div>
          </div>

          {isTranscribing && (
            <div className="rounded-xl border border-dashed p-4 flex items-center gap-3 text-sm text-muted-foreground">
              <CircleNotchIcon className="size-4 animate-spin shrink-0" />
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
                <CalendarBlankIcon className="size-4 shrink-0" />
                Planifiée le {format(new Date(meeting.scheduledAt), "d MMM yyyy 'à' HH'h'mm", { locale: fr })}
              </span>
            )}
            {meeting.startedAt && (
              <span className="flex items-center gap-1.5">
                <VideoCameraIcon className="size-4 shrink-0" />
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
          {canSummarize && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Compte-rendu IA</Label>
                <Button
                  size="sm"
                  onClick={() => summarize.mutate()}
                  loading={summarize.isPending}
                  disabled={!transcript.trim()}
                >
                  <SparkleIcon className="size-3.5 mr-1.5" />
                  {meeting.summary ? "Regénérer" : "Générer"}
                </Button>
              </div>

              {meeting.summary ? (
                <div className="rounded-xl border bg-muted/30 p-4 text-sm whitespace-pre-wrap leading-relaxed">
                  {meeting.summary}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed p-6 text-center">
                  <SparkleIcon className="size-7 text-muted-foreground/40 mx-auto mb-2" />
                  <p className="text-xs text-muted-foreground">
                    {transcript.trim()
                      ? "Cliquez sur « Générer » pour créer le compte-rendu."
                      : "La transcription est nécessaire pour générer le résumé."}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
