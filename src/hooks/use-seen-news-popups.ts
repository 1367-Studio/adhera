"use client"

import { markPopupContentSeenFor, useSeenPopupContent } from "@/hooks/use-seen-popup-content"

/** Bump the suffix to re-show every "Notícias" pop-up entry to everyone. */
const SEEN_NEWS_POPUPS_KEY_PREFIX = "adhera-news-popups-seen-v1"

export function markNewsPopupsSeenFor(userId: string, entryIds: string[]) {
  markPopupContentSeenFor(SEEN_NEWS_POPUPS_KEY_PREFIX, userId, entryIds)
}

export function useSeenNewsPopups(userId: string) {
  return useSeenPopupContent(SEEN_NEWS_POPUPS_KEY_PREFIX, userId)
}
