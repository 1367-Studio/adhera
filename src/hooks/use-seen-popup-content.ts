"use client"

import { useSyncExternalStore } from "react"

// Only the pop-up's recent window (≤ 10 entries) matters per content kind, so the list never
// needs to grow past this.
const MAX_STORED_IDS = 100

// Namespaced per logged-in user: several association accounts commonly share one browser
// (same office computer), and a shared key would mark entries seen for every account the
// moment any one of them closed the pop-up.
function storageKeyFor(keyPrefix: string, userId: string) {
  return `${keyPrefix}:${userId}`
}

function readSeenIds(storageKey: string): string[] {
  try {
    const storedValue = JSON.parse(localStorage.getItem(storageKey) ?? "[]")
    return Array.isArray(storedValue) ? storedValue.filter((entryId) => typeof entryId === "string") : []
  } catch {
    return []
  }
}

// One module-level store per (keyPrefix, userId), shared by every hook instance (pop-up and
// notification bell, when a content kind has one) for that user, so a markSeen from either
// updates both immediately. It is also the source of truth when localStorage is unavailable, so
// "seen" still holds for the rest of the visit.
const seenIdsStores: Map<string, string[]> = new Map()
const storeListenersByKey: Map<string, Set<() => void>> = new Map()
// One bound "storage" listener per (keyPrefix, userId), reused across subscribers, so adding it
// (for the first subscriber) and removing it (for the last) always target the same function
// reference.
const windowListenersByKey: Map<string, (event: StorageEvent) => void> = new Map()

function notifyStoreListeners(storageKey: string) {
  storeListenersByKey.get(storageKey)?.forEach((storeListener) => storeListener())
}

// Another tab marked entries seen: reload from storage.
function handleStorageEvent(storageKey: string, event: StorageEvent) {
  if (event.key !== storageKey && event.key !== null) return
  seenIdsStores.set(storageKey, readSeenIds(storageKey))
  notifyStoreListeners(storageKey)
}

function subscribeToSeenIds(storageKey: string, storeListener: () => void) {
  let listeners = storeListenersByKey.get(storageKey)
  if (!listeners) {
    listeners = new Set()
    storeListenersByKey.set(storageKey, listeners)
  }
  if (listeners.size === 0) {
    const onStorage = (event: StorageEvent) => handleStorageEvent(storageKey, event)
    windowListenersByKey.set(storageKey, onStorage)
    window.addEventListener("storage", onStorage)
  }
  listeners.add(storeListener)
  return () => {
    listeners!.delete(storeListener)
    if (listeners!.size === 0) {
      const onStorage = windowListenersByKey.get(storageKey)
      if (onStorage) window.removeEventListener("storage", onStorage)
      windowListenersByKey.delete(storageKey)
    }
  }
}

function getSeenIdsSnapshot(storageKey: string): string[] {
  if (!seenIdsStores.has(storageKey)) seenIdsStores.set(storageKey, readSeenIds(storageKey))
  return seenIdsStores.get(storageKey)!
}

// null on the server and during hydration ("not loaded yet"), so nothing is decided on it.
function getServerSeenIdsSnapshot(): string[] | null {
  return null
}

export function markPopupContentSeenFor(keyPrefix: string, userId: string, entryIds: string[]) {
  const storageKey = storageKeyFor(keyPrefix, userId)
  // Oldest first, newest appended last, so trimming keeps the most recent ids.
  const mergedIds = [...new Set([...getSeenIdsSnapshot(storageKey), ...entryIds])].slice(-MAX_STORED_IDS)
  try {
    localStorage.setItem(storageKey, JSON.stringify(mergedIds))
  } catch {
    // Storage unavailable (private mode, blocked site data): the in-memory store still holds
    // it for this visit; the pop-up may show again next time.
  }
  seenIdsStores.set(storageKey, mergedIds)
  notifyStoreListeners(storageKey)
}

// `keyPrefix` isolates each content kind's "seen" list from the others (release notes, news,
// FAQ pop-ups) — pass a stable, content-kind-specific prefix, e.g.
// "adhera-release-notes-seen-v1". Bump a prefix's version suffix to re-show every entry of that
// kind to everyone.
export function useSeenPopupContent(keyPrefix: string, userId: string) {
  const storageKey = storageKeyFor(keyPrefix, userId)
  const seenIds = useSyncExternalStore<string[] | null>(
    (storeListener) => subscribeToSeenIds(storageKey, storeListener),
    () => getSeenIdsSnapshot(storageKey),
    getServerSeenIdsSnapshot,
  )
  const markSeen = (entryIds: string[]) => markPopupContentSeenFor(keyPrefix, userId, entryIds)
  return { seenIds, markSeen }
}
