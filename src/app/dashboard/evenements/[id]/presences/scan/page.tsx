"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useParams } from "next/navigation"
import { useTranslations } from "next-intl"
import jsQR from "jsqr"
import { toast } from "sonner"
import { CheckCircleIcon, WarningCircleIcon, XCircleIcon, CameraSlashIcon } from "@phosphor-icons/react/dist/ssr";
import { useEvenement } from "@/hooks/use-evenements"
import { BackLink } from "@/components/ui/back-link"
import { cn } from "@/lib/utils"

type ScanStatus = "VALID" | "ALREADY" | "NOT_PAID" | "CANCELLED" | "WRONG_EVENT" | "INVALID" | "FULL"
type ScanResult = {
  status:     ScanStatus
  attendee?:  { firstName: string; lastName: string; ticketTypeLabel: string | null }
  eventTitle?: string
}

// How long a scan verdict stays on screen before the camera resumes on its own — long
// enough to read a name at the door, short enough to keep a queue moving. Tapping the
// overlay resumes immediately.
const RESULT_DISPLAY_MS   = 3200
// The same QR sits in front of the camera for many frames — ignore repeats of the last
// decoded content for a moment instead of re-posting it several times per second.
const DUPLICATE_IGNORE_MS = 4000

const RESULT_STYLES: Record<ScanStatus, { bg: string; icon: typeof CheckCircleIcon }> = {
  VALID:       { bg: "bg-green-600", icon: CheckCircleIcon },
  ALREADY:     { bg: "bg-amber-500", icon: WarningCircleIcon },
  NOT_PAID:    { bg: "bg-red-600",   icon: XCircleIcon },
  CANCELLED:   { bg: "bg-red-600",   icon: XCircleIcon },
  WRONG_EVENT: { bg: "bg-red-600",   icon: XCircleIcon },
  INVALID:     { bg: "bg-red-600",   icon: XCircleIcon },
  FULL:        { bg: "bg-red-600",   icon: XCircleIcon },
}

export default function ScanTicketsPage() {
  const { id } = useParams<{ id: string }>()
  const t      = useTranslations("evenements.scanner")

  const { data: evenement } = useEvenement(id)
  const ev = evenement as { title?: string } | undefined

  const videoRef        = useRef<HTMLVideoElement | null>(null)
  const streamRef       = useRef<MediaStream | null>(null)
  // True while a verdict overlay is up or a POST is in flight — the decode loop keeps
  // running but stays idle, so resuming is just flipping this back.
  const pausedRef       = useRef(false)
  const lastDecodedRef  = useRef<{ text: string; at: number } | null>(null)
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [cameraState, setCameraState] = useState<"starting" | "active" | "error">("starting")
  const [result, setResult]           = useState<ScanResult | null>(null)
  const [validCount, setValidCount]   = useState(0)

  useEffect(() => {
    let cancelled = false
    const video = videoRef.current
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      .then(stream => {
        if (cancelled || !video) {
          stream.getTracks().forEach(track => track.stop())
          return
        }
        streamRef.current = stream
        video.srcObject = stream
        return video.play().then(() => { if (!cancelled) setCameraState("active") })
      })
      .catch(() => { if (!cancelled) setCameraState("error") })
    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach(track => track.stop())
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
    }
  }, [])

  const dismissResult = useCallback(() => {
    if (dismissTimerRef.current) {
      clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = null
    }
    setResult(null)
    pausedRef.current = false
  }, [])

  const handleDecoded = useCallback(async (text: string) => {
    const now  = Date.now()
    const last = lastDecodedRef.current
    if (last && last.text === text && now - last.at < DUPLICATE_IGNORE_MS) return
    lastDecodedRef.current = { text, at: now }
    pausedRef.current = true
    try {
      const res = await fetch(`/api/evenements/${id}/scan`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ token: text }),
      })
      if (!res.ok) throw new Error()
      const data: ScanResult = await res.json()
      if (data.status === "VALID") setValidCount(c => c + 1)
      setResult(data)
      if (dismissTimerRef.current) clearTimeout(dismissTimerRef.current)
      dismissTimerRef.current = setTimeout(() => {
        dismissTimerRef.current = null
        setResult(null)
        pausedRef.current = false
      }, RESULT_DISPLAY_MS)
    } catch {
      toast.error(t("errorNetwork"))
      pausedRef.current = false
    }
  }, [id, t])

  useEffect(() => {
    if (cameraState !== "active") return
    const canvas = document.createElement("canvas")
    const ctx2d  = canvas.getContext("2d", { willReadFrequently: true })
    const interval = setInterval(() => {
      const video = videoRef.current
      if (!video || !ctx2d || pausedRef.current || video.readyState < 2 || !video.videoWidth) return
      // Decoding runs on a downscaled frame — full HD frames cost jsQR far more than the
      // QR's legibility gains.
      const scale = Math.min(1, 640 / video.videoWidth)
      canvas.width  = Math.floor(video.videoWidth * scale)
      canvas.height = Math.floor(video.videoHeight * scale)
      ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height)
      const imageData = ctx2d.getImageData(0, 0, canvas.width, canvas.height)
      const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" })
      if (code?.data) void handleDecoded(code.data)
    }, 250)
    return () => clearInterval(interval)
  }, [cameraState, handleDecoded])

  const style = result ? RESULT_STYLES[result.status] : null
  const ResultIcon = style?.icon ?? CheckCircleIcon

  return (
    <div className="space-y-4">
      <div>
        <BackLink href={`/dashboard/evenements/${id}/presences`}>{t("back")}</BackLink>
      </div>

      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">
          {ev?.title}
          {validCount > 0 && ` · ${t("validCount", { count: validCount })}`}
        </p>
      </div>

      <div className="mx-auto w-full max-w-md space-y-2">
        <div className="relative aspect-[3/4] sm:aspect-video overflow-hidden rounded-lg border bg-black">
          {/* playsInline + muted: required for iOS Safari to render a live camera feed */}
          <video ref={videoRef} playsInline muted className="absolute inset-0 size-full object-cover" />
          {cameraState === "starting" && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="size-6 rounded-full border-2 border-white/80 border-t-transparent animate-spin" />
            </div>
          )}
          {cameraState === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <CameraSlashIcon className="size-10 text-white/60" />
              <p className="text-sm text-white/80">{t("cameraError")}</p>
            </div>
          )}
        </div>
        <p className="text-center text-xs text-muted-foreground">{t("hint")}</p>
      </div>

      {result && style && (
        <button
          type="button"
          onClick={dismissResult}
          className={cn("fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 px-6 text-center text-white", style.bg)}
        >
          <ResultIcon weight="fill" className="size-20" />
          <p className="text-2xl font-bold">
            {result.status === "WRONG_EVENT"
              ? t("statusWrongEvent", { title: result.eventTitle ?? "" })
              : t(`status${result.status === "VALID" ? "Valid"
                  : result.status === "ALREADY" ? "Already"
                  : result.status === "NOT_PAID" ? "NotPaid"
                  : result.status === "CANCELLED" ? "Cancelled"
                  : result.status === "FULL" ? "Full"
                  : "Invalid"}`)}
          </p>
          {result.attendee && (
            <p className="text-lg">
              {result.attendee.firstName} {result.attendee.lastName}
              {result.attendee.ticketTypeLabel && (
                <span className="block text-sm opacity-80">{result.attendee.ticketTypeLabel}</span>
              )}
            </p>
          )}
          <p className="text-sm opacity-75">{t("tapToContinue")}</p>
        </button>
      )}
    </div>
  )
}
