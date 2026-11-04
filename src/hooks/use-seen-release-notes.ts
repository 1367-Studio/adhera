"use client"

import { markPopupContentSeenFor, useSeenPopupContent } from "@/hooks/use-seen-popup-content"

/** Bump the suffix to re-show every "What's new" entry to everyone. */
const SEEN_RELEASE_NOTES_KEY_PREFIX = "adhera-release-notes-seen-v1"

export function markReleaseNotesSeenFor(userId: string, entryIds: string[]) {
  markPopupContentSeenFor(SEEN_RELEASE_NOTES_KEY_PREFIX, userId, entryIds)
}

export function useSeenReleaseNotes(userId: string) {
  return useSeenPopupContent(SEEN_RELEASE_NOTES_KEY_PREFIX, userId)
}
