"use client"

import { markPopupContentSeenFor, useSeenPopupContent } from "@/hooks/use-seen-popup-content"

/** Bump the suffix to re-show every FAQ pop-up entry to everyone. */
const SEEN_FAQ_POPUPS_KEY_PREFIX = "adhera-faq-popups-seen-v1"

export function markFaqPopupsSeenFor(userId: string, entryIds: string[]) {
  markPopupContentSeenFor(SEEN_FAQ_POPUPS_KEY_PREFIX, userId, entryIds)
}

export function useSeenFaqPopups(userId: string) {
  return useSeenPopupContent(SEEN_FAQ_POPUPS_KEY_PREFIX, userId)
}
