"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { LocalVideoTrack } from "livekit-client"
import { useLocalParticipant } from "@livekit/components-react"
import type { BackgroundProcessorWrapper } from "@livekit/track-processors"
import { BASE_PATH } from "@/lib/env"

const BLUR_RADIUS = 12
const STORAGE_KEY = "formwise.meeting.background-blur"

// Self-hosted so a call never reaches out to jsdelivr / storage.googleapis.com mid-meeting:
// the WASM is copied out of node_modules by scripts/copy-mediapipe-assets.mjs (gitignored,
// kept in lockstep with the installed @mediapipe/tasks-vision), the segmenter model is
// committed under public/mediapipe.
const ASSET_PATHS = {
  tasksVisionFileSet: `${BASE_PATH}/mediapipe/wasm`,
  modelAssetPath:     `${BASE_PATH}/mediapipe/selfie_segmenter.tflite`,
}

// Mirrors supportsBackgroundProcessors() from @livekit/track-processors. Replicated instead
// of imported on purpose: importing it would pull the whole ~10 MB MediaPipe bundle into
// every meeting just to decide whether to render one button. Worth re-checking against the
// library's own isSupported getters when bumping that dependency.
export function supportsBackgroundBlur(): boolean {
  if (typeof window === "undefined") return false

  const canProcessFrames =
    (typeof MediaStreamTrackGenerator !== "undefined" && typeof MediaStreamTrackProcessor !== "undefined") ||
    (typeof VideoFrame !== "undefined" && "captureStream" in HTMLCanvasElement.prototype)

  const canSegment =
    typeof OffscreenCanvas !== "undefined" &&
    typeof VideoFrame !== "undefined" &&
    typeof createImageBitmap !== "undefined" &&
    !!document.createElement("canvas").getContext("webgl2")

  return canProcessFrames && canSegment
}

function readStoredPreference(): boolean {
  if (typeof window === "undefined") return false
  try {
    return localStorage.getItem(STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

/**
 * Blurs the background of the local camera track. The effect is applied client-side before
 * the track is published, so remote participants (and any recording) only ever see the
 * blurred frames — the raw background never leaves the machine.
 */
export function useBackgroundBlur({ onError }: { onError?: () => void } = {}) {
  const { cameraTrack } = useLocalParticipant()
  const [enabled, setEnabled] = useState(readStoredPreference)
  const [pending, setPending] = useState(false)
  const processorRef = useRef<BackgroundProcessorWrapper | null>(null)

  const localVideoTrack = cameraTrack?.track instanceof LocalVideoTrack ? cameraTrack.track : null

  // Loaded on first use rather than with the page: MediaPipe is by far the heaviest thing in
  // the room, and most meetings never turn the blur on.
  const getProcessor = useCallback(async () => {
    if (!processorRef.current) {
      const { BackgroundProcessor } = await import("@livekit/track-processors")
      processorRef.current = BackgroundProcessor({
        mode:       "background-blur",
        blurRadius: BLUR_RADIUS,
        assetPaths: ASSET_PATHS,
      })
    }
    return processorRef.current
  }, [])

  const toggle = useCallback(async () => {
    if (!localVideoTrack || pending) return
    const next = !enabled
    setPending(true)
    try {
      if (next) {
        await localVideoTrack.setProcessor(await getProcessor())
      } else {
        await localVideoTrack.stopProcessor()
      }
      setEnabled(next)
      try { localStorage.setItem(STORAGE_KEY, next ? "1" : "0") } catch { /* private mode */ }
    } catch (err) {
      console.error("[meeting] background blur failed", err)
      onError?.()
    } finally {
      setPending(false)
    }
  }, [enabled, pending, localVideoTrack, getProcessor, onError])

  // Re-apply across camera track swaps — turning the camera off and back on, or switching
  // device, hands us a brand new track with no processor attached, which would silently drop
  // the blur (and reveal the room) while the button still reads "on".
  useEffect(() => {
    if (!enabled || !localVideoTrack || localVideoTrack.getProcessor()) return
    let cancelled = false
    void (async () => {
      try {
        const processor = await getProcessor()
        if (!cancelled) await localVideoTrack.setProcessor(processor)
      } catch (err) {
        console.error("[meeting] background blur re-apply failed", err)
      }
    })()
    return () => { cancelled = true }
  }, [enabled, localVideoTrack, getProcessor])

  return {
    enabled,
    pending,
    toggle,
    available: !!localVideoTrack,
  }
}
