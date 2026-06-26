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
} from "@livekit/components-react"
import { Track } from "livekit-client"
import {
  Loader2, MicIcon, MicOffIcon, VideoIcon, VideoOffIcon,
  PhoneOffIcon, CircleIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useMeetingToken } from "@/hooks/use-meetings"

type Props = {
  meetingId:      string
  onLeave:        () => void
  tokenEndpoint?: string
  isAdmin?:       boolean
}

function initials(name: string) {
  return name.split(" ").map(n => n[0] ?? "").join("").slice(0, 2).toUpperCase()
}

function VideoGrid() {
  const tracks = useTracks(
    [{ source: Track.Source.Camera, withPlaceholder: true }],
    { onlySubscribed: false },
  )

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

function Controls({
  meetingId,
  isAdmin,
  onLeave,
  recording,
}: {
  meetingId: string
  isAdmin:   boolean
  onLeave:   () => void
  recording: boolean
}) {
  const { isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant()
  const room      = useRoomContext()
  const [ending, setEnding] = useState(false)

  async function handleEnd() {
    setEnding(true)
    try {
      if (isAdmin) {
        const res = await fetch(`/api/meetings/${meetingId}/egress`, { method: "DELETE" })
        if (!res.ok) {
          // egress stop failed but we still disconnect
          console.error("Egress stop failed:", await res.text())
        }
      }
    } finally {
      room.disconnect()
      onLeave()
    }
  }

  return (
    <div className="flex items-center justify-center gap-3 px-6 py-4 border-t bg-card shrink-0">
      {isAdmin && (
        <div className="flex items-center gap-1.5 mr-2 text-xs text-muted-foreground">
          <CircleIcon
            className={cn(
              "size-2 fill-current",
              recording ? "text-red-500 animate-pulse" : "text-muted-foreground/30",
            )}
          />
          {recording ? "Enregistrement" : "En attente…"}
        </div>
      )}

      <TrackToggle
        source={Track.Source.Microphone}
        className={cn(
          "flex size-11 items-center justify-center rounded-full border transition-colors",
          isMicrophoneEnabled
            ? "bg-card hover:bg-muted"
            : "bg-destructive/10 border-destructive/30 text-destructive hover:bg-destructive/20",
        )}
        showIcon={false}
      >
        {isMicrophoneEnabled ? <MicIcon className="size-5" /> : <MicOffIcon className="size-5" />}
      </TrackToggle>

      <TrackToggle
        source={Track.Source.Camera}
        className={cn(
          "flex size-11 items-center justify-center rounded-full border transition-colors",
          isCameraEnabled
            ? "bg-card hover:bg-muted"
            : "bg-destructive/10 border-destructive/30 text-destructive hover:bg-destructive/20",
        )}
        showIcon={false}
      >
        {isCameraEnabled ? <VideoIcon className="size-5" /> : <VideoOffIcon className="size-5" />}
      </TrackToggle>

      <Button
        variant="destructive"
        className="rounded-full px-5 h-11"
        onClick={handleEnd}
        loading={ending}
        disabled={ending}
      >
        <PhoneOffIcon className="size-4 mr-2" />
        {isAdmin ? "Encerrer" : "Quitter"}
      </Button>
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
  onLeave:   () => void
}) {
  const [recording, setRecording] = useState(false)
  const startedRef = useRef(false)

  useEffect(() => {
    if (!isAdmin || startedRef.current) return
    startedRef.current = true

    fetch(`/api/meetings/${meetingId}/egress`, { method: "POST" })
      .then(res => { if (res.ok) setRecording(true) })
      .catch(() => { /* egress unavailable, meeting still works */ })
  }, [meetingId, isAdmin])

  return (
    <div className="flex flex-col rounded-xl border overflow-hidden bg-background" style={{ height: 560 }}>
      <div className="flex-1 p-2 min-h-0 overflow-hidden">
        <VideoGrid />
      </div>
      <RoomAudioRenderer />
      <Controls
        meetingId={meetingId}
        isAdmin={isAdmin}
        onLeave={onLeave}
        recording={recording}
      />
    </div>
  )
}

export function MeetingRoom({ meetingId, onLeave, tokenEndpoint, isAdmin = false }: Props) {
  const { data, isLoading, error } = useMeetingToken(meetingId, tokenEndpoint)

  const handleDisconnected = useCallback(() => {
    onLeave()
  }, [onLeave])

  if (isLoading) {
    return (
      <div className="flex h-[560px] items-center justify-center rounded-xl border bg-card">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
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
