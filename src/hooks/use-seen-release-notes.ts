"use client"

import { useSyncExternalStore } from "react"

/** Bump the suffix to re-show every "What's new" entry to everyone. */
const SEEN_RELEASE_NOTES_KEY = "adhera-release-notes-seen-v1"
// Only the pop-up's recent window (≤ 10 entries, < 90 days) matters, so the list never needs
// to grow past this.
const MAX_STORED_IDS = 100

function readSeenIds(): string[] {
  try {
    const storedValue = JSON.parse(localStorage.getItem(SEEN_RELEASE_NOTES_KEY) ?? "[]")
    return Array.isArray(storedValue) ? storedValue.filter((entryId) => typeof entryId === "string") : []
  } catch {
    return []
  }
}

// One module-level store shared by every hook instance (pop-up and notification bell), so a
// markSeen from either updates both immediately. It is also the source of truth when
// localStorage is unavailable, so "seen" still holds for the rest of the visit.
let seenIdsStore: string[] | null = null
const storeListeners = new Set<() => void>()

function notifyStoreListeners() {
  storeListeners.forEach((storeListener) => storeListener())
}

// Another tab marked entries seen: reload from storage.
function handleStorageEvent(event: StorageEvent) {
  if (event.key !== SEEN_RELEASE_NOTES_KEY && event.key !== null) return
  seenIdsStore = readSeenIds()
  notifyStoreListeners()
}

function subscribeToSeenIds(storeListener: () => void) {
  if (storeListeners.size === 0) window.addEventListener("storage", handleStorageEvent)
  storeListeners.add(storeListener)
  return () => {
    storeListeners.delete(storeListener)
    if (storeListeners.size === 0) window.removeEventListener("storage", handleStorageEvent)
  }
}

function getSeenIdsSnapshot(): string[] {
  if (seenIdsStore === null) seenIdsStore = readSeenIds()
  return seenIdsStore
}

// null on the server and during hydration ("not loaded yet"), so nothing is decided on it.
function getServerSeenIdsSnapshot(): string[] | null {
  return null
}

export function markReleaseNotesSeen(entryIds: string[]) {
  // Oldest first, newest appended last, so trimming keeps the most recent ids.
  const mergedIds = [...new Set([...getSeenIdsSnapshot(), ...entryIds])].slice(-MAX_STORED_IDS)
  try {
    localStorage.setItem(SEEN_RELEASE_NOTES_KEY, JSON.stringify(mergedIds))
  } catch {
    // Storage unavailable (private mode, blocked site data): the in-memory store still holds
    // it for this visit; the pop-up may show again next time.
  }
  seenIdsStore = mergedIds
  notifyStoreListeners()
}

export function useSeenReleaseNotes() {
  const seenIds = useSyncExternalStore<string[] | null>(subscribeToSeenIds, getSeenIdsSnapshot, getServerSeenIdsSnapshot)
  return { seenIds, markSeen: markReleaseNotesSeen }
}
