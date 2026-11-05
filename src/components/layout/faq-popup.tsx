"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslations } from "next-intl"
import { ContentPopupCarousel, type PopupCarouselSlide } from "@/components/layout/content-popup-carousel"
import { useFaqPopups, type FaqPopupEntry } from "@/hooks/use-help"
import { useRemindLater } from "@/hooks/use-remind-later"
import { useSeenFaqPopups } from "@/hooks/use-seen-faq-popups"
import { useCurrentUser } from "@/lib/user-context"

// Set by the first-run guided tour (help-button.tsx). Until it exists the tour owns the
// first visit, so the pop-up waits for a later one instead of stacking on top of it.
const TOUR_SEEN_KEY  = "adhera-tour-seen-v1"
const POPUP_DELAY_MS = 1500
// "Remind me later" storage is separate from the seen-list above: it only suppresses
// re-opening until the next real login (see useRemindLater), never marks anything seen.
const REMIND_LATER_KEY_PREFIX = "adhera-faq-popups-remind-later-v1"

function readTourSeen() {
  if (typeof window === "undefined") return false
  try {
    return !!localStorage.getItem(TOUR_SEEN_KEY)
  } catch {
    return false
  }
}

// Testing aid: `?faq=1` on any dashboard URL forces the pop-up open with every fetched entry,
// ignoring the tour key, the seen list and the `enabled` prop.
const FORCE_PARAM = "faq"

function readForceMode() {
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).get(FORCE_PARAM) === "1"
}

function toSlide(entry: FaqPopupEntry): PopupCarouselSlide {
  return {
    id:      entry.id,
    heading: entry.question,
    body:    entry.answer,
  }
}

type FaqPopupProps = {
  enabled: boolean
  // Used only by HelpPopupQueue — see release-notes-popup.tsx for the exact contract.
  onHasContent?: (hasContent: boolean) => void
  onClose?: () => void
  openDelayMs?: number
}

export function FaqPopup({ enabled, onHasContent, onClose, openDelayMs = POPUP_DELAY_MS }: FaqPopupProps) {
  const t = useTranslations("help.faqPopup")
  const { id: currentUserId, loginAt } = useCurrentUser()
  const { seenIds, markSeen } = useSeenFaqPopups(currentUserId)
  const { remindLater, isRemindedThisLogin } = useRemindLater(REMIND_LATER_KEY_PREFIX, currentUserId)
  const [tourSeen] = useState(readTourSeen)
  const [forceMode] = useState(readForceMode)
  const [slides, setSlides] = useState<FaqPopupEntry[] | null>(null)
  const [open, setOpen] = useState(false)
  const [openKey, setOpenKey] = useState(0)
  // Guards onHasContent against firing twice for the same fetched list — see the matching
  // comment in release-notes-popup.tsx.
  const reportedHasContentForRef = useRef<FaqPopupEntry[] | null>(null)

  const shouldShow = forceMode || (enabled && tourSeen && seenIds !== null)
  const faqQuery = useFaqPopups({ enabled: shouldShow })
  const faqEntries = faqQuery.data
  const remindedThisLogin = isRemindedThisLogin(loginAt)

  const openWithSlides = useCallback((nextSlides: FaqPopupEntry[]) => {
    setSlides(nextSlides)
    setOpen(true)
    setOpenKey((key) => key + 1)
  }, [])

  // Clearing the timer on cleanup keeps Strict Mode's double-invoke from opening twice.
  useEffect(() => {
    if (!shouldShow || !faqEntries || slides !== null) return
    const unseenEntries = forceMode ? faqEntries : faqEntries.filter((entry) => !seenIds?.includes(entry.id))
    // Reported as "nothing to show" while remembered-for-later, even though unseen entries
    // still exist, so the queue moves on to the next kind instead of waiting on this one.
    const hasContentToShow = unseenEntries.length > 0 && (forceMode || !remindedThisLogin)
    if (reportedHasContentForRef.current !== faqEntries) {
      reportedHasContentForRef.current = faqEntries
      onHasContent?.(hasContentToShow)
    }
    if (!hasContentToShow) return

    const openTimer = window.setTimeout(() => openWithSlides(unseenEntries), openDelayMs)
    return () => window.clearTimeout(openTimer)
  }, [shouldShow, forceMode, seenIds, faqEntries, slides, openWithSlides, onHasContent, openDelayMs, remindedThisLogin])

  if (!slides || slides.length === 0) return null

  function handleCarouselClose(viewedIds: string[]) {
    markSeen(viewedIds)
    setOpen(false)
    onClose?.()
  }

  function handleRemindLater() {
    remindLater(loginAt)
    setOpen(false)
    onClose?.()
  }

  return (
    <ContentPopupCarousel
      open={open}
      slides={slides.map(toSlide)}
      initialIndex={0}
      openKey={openKey}
      dialogTitle={t("title")}
      onClose={handleCarouselClose}
      onRemindLater={handleRemindLater}
      autoplay={false}
    />
  )
}
