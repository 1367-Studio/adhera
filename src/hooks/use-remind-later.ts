"use client"

import { useSyncExternalStore } from "react"

// Namespaced per logged-in user, same reasoning as use-seen-popup-content.ts: several
// association accounts commonly share one browser (same office computer), and a shared key
// would suppress the pop-up for every account the moment any one of them clicked "remind
// later".
function storageKeyFor(keyPrefix: string, userId: string) {
  return `${keyPrefix}:${userId}`
}

// Used when the caller doesn't have a loginAt yet (a session that predates SessionUser.loginAt
// — see remindLater() below). No real loginAt is ever this value, so it can't collide.
const UNKNOWN_LOGIN = -1

function readRemindedForLogin(storageKey: string): number | null {
  try {
    const stored = localStorage.getItem(storageKey)
    return stored ? Number(stored) : null
  } catch {
    return null
  }
}

// One module-level store per (keyPrefix, userId) — see use-seen-popup-content.ts for why.
const remindedForLoginStores: Map<string, number | null> = new Map()
const storeListenersByKey: Map<string, Set<() => void>> = new Map()

function notifyStoreListeners(storageKey: string) {
  storeListenersByKey.get(storageKey)?.forEach((storeListener) => storeListener())
}

function subscribeToRemindedForLogin(storageKey: string, storeListener: () => void) {
  let listeners = storeListenersByKey.get(storageKey)
  if (!listeners) {
    listeners = new Set()
    storeListenersByKey.set(storageKey, listeners)
  }
  listeners.add(storeListener)
  return () => listeners!.delete(storeListener)
}

function getRemindedForLoginSnapshot(storageKey: string): number | null {
  if (!remindedForLoginStores.has(storageKey)) remindedForLoginStores.set(storageKey, readRemindedForLogin(storageKey))
  return remindedForLoginStores.get(storageKey)!
}

// null on the server and during hydration, same convention as use-seen-popup-content.ts.
function getServerRemindedForLoginSnapshot(): number | null {
  return null
}

// `keyPrefix` isolates each pop-up kind's "remind later" click from the others (release notes,
// news, FAQ), same convention as use-seen-popup-content.ts's keyPrefix.
//
// Deliberately NOT the same storage as markSeen: "remind later" must stop suppressing the
// pop-up on the next real login, while markSeen is permanent.
//
// Stores WHICH login the click happened during (the session's loginAt, stamped server-side at
// sign-in — see SessionUser.loginAt) rather than a client-side clock reading. Comparing a
// browser timestamp against a server-stamped one breaks whenever the user's system clock is
// wrong — common enough to matter — in both directions: a clock running behind makes the
// reminder reappear immediately, and one running ahead can wedge it suppressed well past the
// next real login. Comparing two loginAt values instead means no clock is involved on either
// side: it's simply "is this still the same login".
export function useRemindLater(keyPrefix: string, userId: string) {
  const storageKey = storageKeyFor(keyPrefix, userId)
  const remindedForLogin = useSyncExternalStore<number | null>(
    (storeListener) => subscribeToRemindedForLogin(storageKey, storeListener),
    () => getRemindedForLoginSnapshot(storageKey),
    getServerRemindedForLoginSnapshot,
  )

  function remindLater(loginAt: number | undefined) {
    const value = loginAt ?? UNKNOWN_LOGIN
    try {
      localStorage.setItem(storageKey, String(value))
    } catch {
      // Storage unavailable (private mode, blocked site data): the in-memory store still
      // suppresses the pop-up for the rest of this visit.
    }
    remindedForLoginStores.set(storageKey, value)
    notifyStoreListeners(storageKey)
  }

  // True only while remindLater() was called during this exact login — the very next real
  // login (including one from a session that previously had no loginAt at all) stamps a
  // different value and this goes back to false, so "remind later" can never wedge shut.
  function isRemindedThisLogin(loginAt: number | undefined) {
    if (remindedForLogin === null) return false
    return remindedForLogin === (loginAt ?? UNKNOWN_LOGIN)
  }

  return { remindLater, isRemindedThisLogin }
}
