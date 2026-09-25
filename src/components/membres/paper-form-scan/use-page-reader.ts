"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import type { PaperFormExtractResponse } from "@/lib/schemas/paper-form"
import { extractPage } from "./scan-api"
import type { ScanPageStatus } from "./scan-model"

// Three pages in flight: enough to keep a 30-page batch moving, few enough not to trip the
// provider's own per-minute limits on the association's key.
const READ_CONCURRENCY = 3

export type PagePayload = { base64: string; mediaType: "image/jpeg" | "image/png" }

export type PageReadUpdate = {
  status: ScanPageStatus
  error:  string | null
  result?: PaperFormExtractResponse
  // Title the model read on a refused page (strict template), when it could read one.
  detectedTitle?: string | null
}

export type ReaderStop = { kind: "fatal" | "rateLimited"; message: string; visionNotSupported: boolean }

type PageReaderOptions = {
  onPageUpdate:    (pageId: string, update: PageReadUpdate) => void
  fallbackMessage: string
}

// Runs POST /api/membres/scan/extract over a queue of pages, READ_CONCURRENCY at a time. A
// page error stays on that page (retry later); a page a strict template refuses stays
// refused while the others go on; a batch-wide refusal (no vision key, module off) or the
// hourly limit halts the queue, leaving the untouched pages pending for resume.
export function usePageReader({ onPageUpdate, fallbackMessage }: PageReaderOptions) {
  // Page bytes live here, outside React state, and are dropped as soon as a page is read:
  // only a retry needs them again, and 300 pages of base64 have no business being rendered.
  const payloadsRef     = useRef(new Map<string, PagePayload>())
  const queueRef        = useRef<string[]>([])
  const activeCountRef  = useRef(0)
  const haltedRef       = useRef(false)
  const templateIdRef   = useRef("")
  const controllerRef   = useRef<AbortController | null>(null)
  const onUpdateRef     = useRef(onPageUpdate)
  const fallbackRef     = useRef(fallbackMessage)
  const [isRunning, setIsRunning] = useState(false)
  const [stop, setStop]           = useState<ReaderStop | null>(null)

  useEffect(() => {
    onUpdateRef.current = onPageUpdate
    fallbackRef.current = fallbackMessage
  }, [onPageUpdate, fallbackMessage])

  useEffect(() => () => controllerRef.current?.abort(), [])

  // Starts up to READ_CONCURRENCY workers; each one pulls pages off the shared queue until
  // it is empty or the batch is halted.
  const pump = useCallback(() => {
    const controller = controllerRef.current
    if (!controller) return

    const readQueuedPages = async () => {
      try {
        while (!haltedRef.current && queueRef.current.length > 0) {
          const pageId  = queueRef.current.shift() as string
          const payload = payloadsRef.current.get(pageId)
          if (!payload) continue
          onUpdateRef.current(pageId, { status: "reading", error: null })

          const outcome = await extractPage(templateIdRef.current, payload, controller.signal, fallbackRef.current)
          if (controllerRef.current !== controller) return
          if (outcome.kind === "success") {
            payloadsRef.current.delete(pageId)
            onUpdateRef.current(pageId, { status: "done", error: null, result: outcome.data })
          } else if (outcome.kind === "pageError") {
            onUpdateRef.current(pageId, { status: "error", error: outcome.message })
          } else if (outcome.kind === "formMismatch") {
            // Not the expected form: no retry will change that, so the bytes can go.
            payloadsRef.current.delete(pageId)
            onUpdateRef.current(pageId, { status: "refused", error: outcome.message, detectedTitle: outcome.detectedTitle })
          } else {
            // The page itself is fine: back to pending, first in line on resume.
            haltedRef.current = true
            queueRef.current.unshift(pageId)
            onUpdateRef.current(pageId, { status: "pending", error: null })
            const visionNotSupported = outcome.kind === "fatal" && outcome.visionNotSupported
            setStop((currentStop) => currentStop ?? { kind: outcome.kind, message: outcome.message, visionNotSupported })
          }
        }
      } catch {
        // Aborted on unmount/reset: nothing left to update.
        return
      } finally {
        // After a reset the counter already restarted from zero for a new controller.
        if (controllerRef.current === controller) {
          activeCountRef.current -= 1
          if (activeCountRef.current === 0) setIsRunning(false)
        }
      }
    }

    while (!haltedRef.current && activeCountRef.current < READ_CONCURRENCY && activeCountRef.current < queueRef.current.length) {
      activeCountRef.current += 1
      void readQueuedPages()
    }
  }, [])

  // Queues pages (in the given order) and starts reading if nothing is running.
  const enqueue = useCallback((templateId: string, pageIds: string[]) => {
    templateIdRef.current = templateId
    controllerRef.current ??= new AbortController()
    const alreadyQueued = new Set(queueRef.current)
    queueRef.current.push(...pageIds.filter((pageId) => !alreadyQueued.has(pageId)))
    if (queueRef.current.length === 0) return
    setIsRunning(true)
    pump()
  }, [pump])

  const resume = useCallback(() => {
    haltedRef.current = false
    setStop(null)
    if (queueRef.current.length === 0) return
    setIsRunning(true)
    pump()
  }, [pump])

  const addPayloads = useCallback((entries: [string, PagePayload][]) => {
    for (const [pageId, payload] of entries) payloadsRef.current.set(pageId, payload)
  }, [])

  const removePayloads = useCallback((pageIds: string[]) => {
    for (const pageId of pageIds) payloadsRef.current.delete(pageId)
    const removedIds = new Set(pageIds)
    queueRef.current = queueRef.current.filter((pageId) => !removedIds.has(pageId))
  }, [])

  // Drops everything in flight and queued — used when the manager starts over.
  const reset = useCallback(() => {
    payloadsRef.current.clear()
    controllerRef.current?.abort()
    controllerRef.current = null
    queueRef.current      = []
    activeCountRef.current = 0
    haltedRef.current     = false
    setIsRunning(false)
    setStop(null)
  }, [])

  return { addPayloads, removePayloads, enqueue, resume, reset, isRunning, stop }
}
