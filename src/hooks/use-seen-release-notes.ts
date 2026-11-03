"use client"

import { useSyncExternalStore } from "react"

/** Bump the suffix to re-show every "What's new" entry to everyone. */
const SEEN_RELEASE_NOTES_KEY_PREFIX = "adhera-release-notes-seen-v1"
// Only the pop-up's recent window (≤ 10 entries, < 90 days) matters, so the list never needs
// to grow past this.
const MAX_STORED_IDS = 100

// Namespaced per logged-in user: several association accounts commonly share one browser
// (same office computer), and a shared key would mark entries seen for every account the
// moment any one of them closed the pop-up.
function storageKeyFor(userId: string) {
  return `${SEEN_RELEASE_NOTES_KEY_PREFIX}:${userId}`
}

function readSeenIds(storageKey: string): string[] {
  try {
    const storedValue = JSON.parse(localStorage.getItem(storageKey) ?? "[]")
    return Array.isArray(storedValue) ? storedValue.filter((entryId) => typeof entryId === "string") : []
  } catch {
    return []
  }
}

// One module-level store per user, shared by every hook instance (pop-up and notification
// bell) for that user, so a markSeen from either updates both immediately. It is also the
// source of truth when localStorage is unavailable, so "seen" still holds for the rest of the
// visit.
const seenIdsStores: Map<string, string[]> = new Map()
const storeListenersByUser: Map<string, Set<() => void>> = new Map()
// One bound "storage" listener per user, reused across subscribers, so adding it (for the
// first subscriber) and removing it (for the last) always target the same function reference.
const windowListenersByUser: Map<string, (event: StorageEvent) => void> = new Map()

function notifyStoreListeners(userId: string) {
  storeListenersByUser.get(userId)?.forEach((storeListener) => storeListener())
}

// Another tab marked entries seen: reload from storage.
function handleStorageEvent(userId: string, storageKey: string, event: StorageEvent) {
  if (event.key !== storageKey && event.key !== null) return
  seenIdsStores.set(userId, readSeenIds(storageKey))
  notifyStoreListeners(userId)
}

function subscribeToSeenIds(userId: string, storageKey: string, storeListener: () => void) {
  let listeners = storeListenersByUser.get(userId)
  if (!listeners) {
    listeners = new Set()
    storeListenersByUser.set(userId, listeners)
  }
  if (listeners.size === 0) {
    const onStorage = (event: StorageEvent) => handleStorageEvent(userId, storageKey, event)
    windowListenersByUser.set(userId, onStorage)
    window.addEventListener("storage", onStorage)
  }
  listeners.add(storeListener)
  return () => {
    listeners!.delete(storeListener)
    if (listeners!.size === 0) {
      const onStorage = windowListenersByUser.get(userId)
      if (onStorage) window.removeEventListener("storage", onStorage)
      windowListenersByUser.delete(userId)
    }
  }
}

function getSeenIdsSnapshot(userId: string, storageKey: string): string[] {
  if (!seenIdsStores.has(userId)) seenIdsStores.set(userId, readSeenIds(storageKey))
  return seenIdsStores.get(userId)!
}

// null on the server and during hydration ("not loaded yet"), so nothing is decided on it.
function getServerSeenIdsSnapshot(): string[] | null {
  return null
}

export function markReleaseNotesSeenFor(userId: string, entryIds: string[]) {
  const storageKey = storageKeyFor(userId)
  // Oldest first, newest appended last, so trimming keeps the most recent ids.
  const mergedIds = [...new Set([...getSeenIdsSnapshot(userId, storageKey), ...entryIds])].slice(-MAX_STORED_IDS)
  try {
    localStorage.setItem(storageKey, JSON.stringify(mergedIds))
  } catch {
    // Storage unavailable (private mode, blocked site data): the in-memory store still holds
    // it for this visit; the pop-up may show again next time.
  }
  seenIdsStores.set(userId, mergedIds)
  notifyStoreListeners(userId)
}

export function useSeenReleaseNotes(userId: string) {
  const storageKey = storageKeyFor(userId)
  const seenIds = useSyncExternalStore<string[] | null>(
    (storeListener) => subscribeToSeenIds(userId, storageKey, storeListener),
    () => getSeenIdsSnapshot(userId, storageKey),
    getServerSeenIdsSnapshot,
  )
  const markSeen = (entryIds: string[]) => markReleaseNotesSeenFor(userId, entryIds)
  return { seenIds, markSeen }
}
