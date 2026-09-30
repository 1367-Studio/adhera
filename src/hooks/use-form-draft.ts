"use client"

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react"

// Public forms (donation, membership, event registration) keep what the visitor typed in
// sessionStorage, so a round-trip through Stripe Checkout — its cancel link, or the browser's
// Back button — brings them back to a filled form instead of a blank one.
//
// sessionStorage, not localStorage: the draft lives in this tab only and dies with it, which
// matters on a shared computer — these forms carry addresses, birth dates and custom answers.
// Consent (legal documents, terms, signature) is never part of a draft: it must be given again.

const DRAFT_KEY_PREFIX       = "formwise:form-draft:"
const DRAFT_MAX_AGE_MS       = 24 * 60 * 60 * 1000
const DRAFT_SAVE_DEBOUNCE_MS = 400

type StoredDraft<Draft> = { version: number; savedAt: number; values: Draft }

function readDraft<Draft>(storageKey: string, version: number): Draft | null {
  try {
    const rawDraft = window.sessionStorage.getItem(storageKey)
    if (!rawDraft) return null
    const storedDraft = JSON.parse(rawDraft) as StoredDraft<Draft>
    const isExpired   = Date.now() - storedDraft.savedAt > DRAFT_MAX_AGE_MS
    if (storedDraft.version !== version || isExpired) {
      window.sessionStorage.removeItem(storageKey)
      return null
    }
    return storedDraft.values
  } catch {
    // Storage blocked (private mode, site data disabled) or a corrupted entry: no draft.
    return null
  }
}

function writeDraft(storageKey: string, serializedDraft: string) {
  try {
    window.sessionStorage.setItem(storageKey, serializedDraft)
  } catch {
    // Quota or storage blocked: the form keeps working, it just won't survive a reload.
  }
}

function removeDraft(storageKey: string) {
  try {
    window.sessionStorage.removeItem(storageKey)
  } catch {
    // Nothing to clean up when storage is unavailable.
  }
}

interface UseFormDraftOptions<Draft> {
  /** Unique per form, e.g. `event:${slug}:${id}`. */
  storageKey: string
  /** Bump when the draft's shape changes: older drafts are then ignored. */
  version:    number
  /** Everything worth restoring — plain JSON only, never consent or payment state. */
  values:     Draft
  /**
   * Restoring waits for this: the form's own configuration (tiers, fields, products) must be
   * loaded so onRestore can drop whatever no longer exists on it.
   */
  isReady:    boolean
  /** Called once with the saved values; the form validates them and sets its state. */
  onRestore:  (savedValues: Draft) => void
}

export function useFormDraft<Draft>({ storageKey, version, values, isReady, onRestore }: UseFormDraftOptions<Draft>) {
  const fullStorageKey = DRAFT_KEY_PREFIX + storageKey

  const [isRestored, setIsRestored] = useState(false)
  // Nothing is saved before the restore attempt, or the empty initial state would overwrite
  // the draft it is about to restore. After clearDraft, nothing is saved at all: the form
  // still holds the submitted values and would otherwise write them straight back.
  const restoreAttemptedRef = useRef(false)
  const isClearedRef        = useRef(false)

  const restoreDraft = useEffectEvent((savedValues: Draft) => onRestore(savedValues))

  useEffect(() => {
    if (!isReady || restoreAttemptedRef.current) return
    restoreAttemptedRef.current = true
    const savedValues = readDraft<Draft>(fullStorageKey, version)
    if (!savedValues) return
    restoreDraft(savedValues)
    setIsRestored(true)
  }, [isReady, fullStorageKey, version])

  // Compared as a string so a re-render with equal values does not reschedule a write.
  const serializedValues = JSON.stringify(values)

  useEffect(() => {
    if (!isReady || !restoreAttemptedRef.current || isClearedRef.current) return
    const saveTimer = window.setTimeout(() => {
      writeDraft(fullStorageKey, `{"version":${version},"savedAt":${Date.now()},"values":${serializedValues}}`)
    }, DRAFT_SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(saveTimer)
  }, [isReady, fullStorageKey, version, serializedValues])

  /** After a successful submission (or payment): forget the draft and stop saving. */
  const clearDraft = useCallback(() => {
    isClearedRef.current = true
    removeDraft(fullStorageKey)
    setIsRestored(false)
  }, [fullStorageKey])

  /** The visitor asked for a blank form: forget the draft and reload the page empty. */
  const discardDraft = useCallback(() => {
    clearDraft()
    window.location.reload()
  }, [clearDraft])

  return { isRestored, clearDraft, discardDraft }
}
