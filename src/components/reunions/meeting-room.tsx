"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  LiveKitRoom,
  RoomAudioRenderer,
  VideoTrack,
  TrackToggle,
  useLocalParticipant,
  useTracks,
  useRoomContext,
  isTrackReference,
  useChat,
} from "@livekit/components-react"
import { Track } from "livekit-client"
import { CircleNotchIcon, MicrophoneIcon, MicrophoneSlashIcon, VideoCameraIcon, VideoCameraSlashIcon, PhoneSlashIcon, CircleIcon, SquareIcon, ChatCircleIcon, PaperPlaneTiltIcon, UsersIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useMeetingToken } from "@/hooks/use-meetings"
import { toast } from "sonner"

type LeaveOpts = { ended?: boolean }

type Props = {
  meetingId:      string
  onLeave:        (opts?: LeaveOpts) => void
  tokenEndpoint?: string
  isAdmin?:       boolean
}

const END_TIMEOUT_MS = 15_000

function initials(name: string) {
  return name.split(" ").map(n => n[0] ?? "").join("").slice(0, 2).toUpperCase()
}

function VideoGrid() {
  const tracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: true }],
    { onlySubscribed: false },
  )

  if (tracks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <UsersIcon className="size-10 opacity-30" />
          <p className="text-sm">En attente de participants…</p>
        </div>
      </div>
    )
  }

  const count    = tracks.length
  const gridCols =
    count === 1 ? "grid-cols-1" :
    count === 2 ? "grid-cols-2" :
    count <= 4  ? "grid-cols-2" :
                  "grid-cols-3"

  return (
    <div className={cn("grid gap-2 h-full", gridCols)}>
      {tracks.map(track => {
        const name     = track.participant.name ?? track.participant.identity
        const hasVideo = isTrackReference(track) && !track.publication?.isMuted

        return (
          <div
            key={track.participant.sid}
            className="relative rounded-xl overflow-hidden bg-muted flex items-center justify-center min-h-0"
          >
            {hasVideo ? (
              <VideoTrack
                trackRef={track as Parameters<typeof VideoTrack>[0]["trackRef"]}
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 select-none">
                <div className="size-16 rounded-full bg-foreground/10 flex items-center justify-center">
                  <span className="text-xl font-semibold text-foreground/60">{initials(name)}</span>
                </div>
                <span className="text-xs text-muted-foreground">{name}</span>
              </div>
            )}
            <div className="absolute bottom-2 left-2 z-10">
              <span className="text-xs bg-black/50 text-white rounded px-1.5 py-0.5 backdrop-blur-sm">
                {name}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ChatPanel({ onClose }: { onClose: () => void }) {
  const { chatMessages, send, isSending } = useChat()
  const [text, setText] = useState("")
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [chatMessages])

  async function handleSend() {
    const msg = text.trim()
    if (!msg) return
    try {
      setText("")
      await send(msg)
    } catch {
      setText(msg)
      toast.error("Impossible d'envoyer le message.")
    }
  }

  return (
    <div className="flex flex-col w-72 border-l bg-card shrink-0">
      <div className="px-3 py-2 border-b flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Chat</span>
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {chatMessages.length === 0 && (
          <p className="text-xs text-muted-foreground text-center pt-4">Aucun message pour le moment.</p>
        )}
        {chatMessages.map((msg, i) => (
          <div key={msg.id ?? i} className="space-y-0.5">
            <p className="text-[10px] text-muted-foreground font-medium">{msg.from?.name ?? msg.from?.identity}</p>
            <p className="text-xs bg-muted rounded-lg px-2.5 py-1.5 break-words">{msg.message}</p>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="p-2 border-t flex gap-1.5">
        <input
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          placeholder="Message…"
          className="flex-1 text-xs rounded-lg border bg-background px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-ring"
        />
        <button
          onClick={handleSend}
          disabled={isSending || !text.trim()}
          className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40 hover:opacity-90 transition-opacity shrink-0"
        >
          <PaperPlaneTiltIcon className="size-3.5" />
        </button>
      </div>
    </div>
  )
}

function Controls({
  meetingId,
  isAdmin,
  onLeave,
  recording,
  onRecordingChange,
  chatOpen,
  onChatToggle,
  unreadCount,
  ending,
  onEndingChange,
}: {
  meetingId:         string
  isAdmin:           boolean
  onLeave:           (opts?: LeaveOpts) => void
  recording:         boolean
  onRecordingChange: (v: boolean) => void
  chatOpen:          boolean
  onChatToggle:      () => void
  unreadCount:       number
  ending:            boolean
  onEndingChange:    (v: boolean) => void
}) {
  const { isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant()
  const room               = useRoomContext()
  const [toggling, setToggling] = useState(false)

  async function handleToggleRecording() {
    setToggling(true)
    try {
      if (recording) {
        await fetch(`/api/meetings/${meetingId}/egress`, { method: "DELETE" })
        onRecordingChange(false)
      } else {
        const res = await fetch(`/api/meetings/${meetingId}/egress`, { method: "POST" })
        if (res.ok) {
          onRecordingChange(true)
        } else {
          toast.error("Impossible de démarrer l'enregistrement.")
        }
      }
    } catch {
      toast.error("Erreur lors de la gestion de l'enregistrement.")
    } finally {
      setToggling(false)
    }
  }

  async function handleEnd() {
    onEndingChange(true)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), END_TIMEOUT_MS)
    try {
      const res = await fetch(`/api/meetings/${meetingId}/end`, { method: "POST", signal: controller.signal })
      if (!res.ok) throw new Error("end failed")
      room.disconnect()
      onLeave({ ended: true })
    } catch {
      // Timed out or failed server-side: don't pretend it worked — surface the error and
      // hand control back so the admin can retry or fall back to "Quitter" themselves.
      toast.error("Impossible de finaliser la réunion. Réessayez.")
      onEndingChange(false)
    } finally {
      clearTimeout(timeout)
    }
  }

  async function handleLeave() {
    room.disconnect()
    onLeave()
  }

  return (
    <div className="flex items-center justify-center gap-3 px-6 py-4 border-t bg-card shrink-0">
      {isAdmin && (
        <button
          onClick={handleToggleRecording}
          disabled={toggling || ending}
          className={cn(
            "flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full border transition-colors mr-2",
            recording
              ? "border-red-300 text-red-500 bg-red-500/10 hover:bg-red-500/20"
              : "border-muted text-muted-foreground hover:bg-muted",
          )}
        >
          {recording
            ? <><CircleIcon className="size-2 fill-current animate-pulse" /> Enregistrement</>
            : <><SquareIcon className="size-3" /> Enregistrer</>
          }
        </button>
      )}

      <div className="relative">
        <button
          onClick={onChatToggle}
          disabled={ending}
          className={cn(
            "flex size-11 items-center justify-center rounded-full border transition-colors",
            chatOpen ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-muted",
          )}
        >
          <ChatCircleIcon className="size-5" />
        </button>
        {unreadCount > 0 && !chatOpen && (
          <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </div>

      <TrackToggle
        source={Track.Source.Microphone}
        disabled={ending}
        className={cn(
          "flex size-11 items-center justify-center rounded-full border transition-colors",
          isMicrophoneEnabled
            ? "bg-card hover:bg-muted"
            : "bg-destructive/10 border-destructive/30 text-destructive hover:bg-destructive/20",
        )}
        showIcon={false}
      >
        {isMicrophoneEnabled ? <MicrophoneIcon className="size-5" /> : <MicrophoneSlashIcon className="size-5" />}
      </TrackToggle>

      <TrackToggle
        source={Track.Source.Camera}
        disabled={ending}
        className={cn(
          "flex size-11 items-center justify-center rounded-full border transition-colors",
          isCameraEnabled
            ? "bg-card hover:bg-muted"
            : "bg-destructive/10 border-destructive/30 text-destructive hover:bg-destructive/20",
        )}
        showIcon={false}
      >
        {isCameraEnabled ? <VideoCameraIcon className="size-5" /> : <VideoCameraSlashIcon className="size-5" />}
      </TrackToggle>

      <Button
        variant="outline"
        className="rounded-full px-5 h-11"
        onClick={handleLeave}
        disabled={ending}
      >
        <PhoneSlashIcon className="size-4 mr-2" />
        Quitter
      </Button>

      {isAdmin && (
        <Button
          variant="destructive"
          className="rounded-full px-5 h-11"
          onClick={handleEnd}
          loading={ending}
          disabled={ending}
        >
          <PhoneSlashIcon className="size-4 mr-2" />
          Encerrer
        </Button>
      )}
    </div>
  )
}

function RoomInner({
  meetingId,
  isAdmin,
  onLeave,
}: {
  meetingId: string
  isAdmin:   boolean
  onLeave:   (opts?: LeaveOpts) => void
}) {
  const [recording,    setRecording]    = useState(false)
  const [chatOpen,     setChatOpen]     = useState(false)
  const [unreadCount,  setUnreadCount]  = useState(0)
  const [ending,       setEnding]       = useState(false)
  const { chatMessages } = useChat()
  const prevCountRef = useRef(0)

  // Sync recording state from DB on mount (handles admin re-joining after mic fix)
  useEffect(() => {
    fetch(`/api/meetings/${meetingId}`)
      .then(r => r.json())
      .then(m => { if (m.egressId) setRecording(true) })
      .catch(() => {})
  }, [meetingId])

  // Badge: count new messages received while chat is closed
  useEffect(() => {
    const newCount = chatMessages.length
    if (!chatOpen && newCount > prevCountRef.current) {
      setUnreadCount(c => c + (newCount - prevCountRef.current))
    }
    prevCountRef.current = newCount
  }, [chatMessages, chatOpen])

  function handleChatToggle() {
    setChatOpen(o => !o)
    setUnreadCount(0)
  }

  return (
    <div className="relative flex rounded-xl border overflow-hidden bg-background" style={{ height: 560 }}>
      {ending && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-background/80 backdrop-blur-sm">
          <CircleNotchIcon className="size-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Finalisation de la réunion…</p>
        </div>
      )}
      <div className="flex flex-col flex-1 min-w-0">
        {recording && (
          <div className="flex items-center justify-center gap-1.5 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-600 shrink-0">
            <CircleIcon className="size-2 fill-current animate-pulse" />
            Cette réunion est enregistrée{!isAdmin ? " et pourra être transcrite" : ""}
          </div>
        )}
        <div className="flex-1 p-2 min-h-0 overflow-hidden">
          <VideoGrid />
        </div>
        <RoomAudioRenderer />
        <Controls
          meetingId={meetingId}
          isAdmin={isAdmin}
          onLeave={onLeave}
          recording={recording}
          onRecordingChange={setRecording}
          chatOpen={chatOpen}
          onChatToggle={handleChatToggle}
          unreadCount={unreadCount}
          ending={ending}
          onEndingChange={setEnding}
        />
      </div>
      {chatOpen && <ChatPanel onClose={() => setChatOpen(false)} />}
    </div>
  )
}

export function MeetingRoom({ meetingId, onLeave, tokenEndpoint, isAdmin = false }: Props) {
  const { data, isLoading, error } = useMeetingToken(meetingId, tokenEndpoint)
  const [kickedOut, setKickedOut] = useState(false)

  const handleDisconnected = useCallback(() => {
    // Reason unknown at this layer (could be the meeting truly ending elsewhere, or just a
    // network blip) — treat it as a potential status change so callers refresh rather than
    // trust possibly-stale cached data.
    if (isAdmin) {
      onLeave({ ended: true })
    } else {
      setKickedOut(true)
      setTimeout(() => onLeave({ ended: true }), 3000)
    }
  }, [isAdmin, onLeave])

  if (isLoading) {
    return (
      <div className="flex h-[560px] items-center justify-center rounded-xl border bg-card">
        <CircleNotchIcon className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="flex h-[560px] items-center justify-center rounded-xl border bg-card">
        <p className="text-sm text-destructive">Impossible de rejoindre la réunion.</p>
      </div>
    )
  }

  if (kickedOut) {
    return (
      <div className="flex h-[560px] items-center justify-center rounded-xl border bg-card">
        <div className="text-center space-y-2">
          <p className="text-sm font-medium">La réunion a été clôturée par l&apos;administrateur.</p>
          <p className="text-xs text-muted-foreground">Vous allez être redirigé…</p>
        </div>
      </div>
    )
  }

  return (
    <LiveKitRoom
      serverUrl={data.serverUrl}
      token={data.token}
      connect
      video
      audio
      onDisconnected={handleDisconnected}
      style={{ display: "contents" }}
    >
      <RoomInner meetingId={meetingId} isAdmin={isAdmin} onLeave={onLeave} />
    </LiveKitRoom>
  )
}
