"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { format, parseISO } from "date-fns"
import { ContentPopupCarousel, type PopupCarouselSlide } from "@/components/layout/content-popup-carousel"
import { useNewsPopups, type NewsPopupEntry } from "@/hooks/use-help"
import { useRemindLater } from "@/hooks/use-remind-later"
import { useSeenNewsPopups } from "@/hooks/use-seen-news-popups"
import type { Locale } from "@/i18n/locales"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import { useCurrentUser } from "@/lib/user-context"

// Set by the first-run guided tour (help-button.tsx). Until it exists the tour owns the
// first visit, so the pop-up waits for a later one instead of stacking on top of it.
const TOUR_SEEN_KEY  = "adhera-tour-seen-v1"
const POPUP_DELAY_MS = 1500
const DATE_FORMAT    = "d MMM yyyy"
// "Remind me later" storage is separate from the seen-list above: it only suppresses
// re-opening until the next real login (see useRemindLater), never marks anything seen.
const REMIND_LATER_KEY_PREFIX = "adhera-news-popups-remind-later-v1"

function readTourSeen() {
  if (typeof window === "undefined") return false
  try {
    return !!localStorage.getItem(TOUR_SEEN_KEY)
  } catch {
    return false
  }
}

// Testing aid: `?actualites=1` on any dashboard URL forces the pop-up open with every fetched
// entry, ignoring the tour key, the seen list and the `enabled` prop.
const FORCE_PARAM = "actualites"

function readForceMode() {
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).get(FORCE_PARAM) === "1"
}

function toSlide(entry: NewsPopupEntry, formattedDate: string): PopupCarouselSlide {
  return {
    id:      entry.id,
    heading: entry.title,
    meta:    <time dateTime={entry.publishedAt}>{formattedDate}</time>,
    image:   entry.image,
    body:    entry.body,
  }
}

type NewsPopupProps = {
  enabled: boolean
  // Used only by HelpPopupQueue — see release-notes-popup.tsx for the exact contract.
  onHasContent?: (hasContent: boolean) => void
  onClose?: () => void
  openDelayMs?: number
}

export function NewsPopup({ enabled, onHasContent, onClose, openDelayMs = POPUP_DELAY_MS }: NewsPopupProps) {
  const t = useTranslations("help.news")
  const locale = useLocale() as Locale
  const { id: currentUserId, loginAt } = useCurrentUser()
  const { seenIds, markSeen } = useSeenNewsPopups(currentUserId)
  const { remindLater, isRemindedThisLogin } = useRemindLater(REMIND_LATER_KEY_PREFIX, currentUserId)
  const [tourSeen] = useState(readTourSeen)
  const [forceMode] = useState(readForceMode)
  const [slides, setSlides] = useState<NewsPopupEntry[] | null>(null)
  const [open, setOpen] = useState(false)
  const [openKey, setOpenKey] = useState(0)
  // Guards onHasContent against firing twice for the same fetched list — see the matching
  // comment in release-notes-popup.tsx.
  const reportedHasContentForRef = useRef<NewsPopupEntry[] | null>(null)

  const shouldShow = forceMode || (enabled && tourSeen && seenIds !== null)
  const newsQuery = useNewsPopups({ enabled: shouldShow })
  const news = newsQuery.data
  const remindedThisLogin = isRemindedThisLogin(loginAt)

  const openWithSlides = useCallback((nextSlides: NewsPopupEntry[]) => {
    setSlides(nextSlides)
    setOpen(true)
    setOpenKey((key) => key + 1)
  }, [])

  // Clearing the timer on cleanup keeps Strict Mode's double-invoke from opening twice.
  useEffect(() => {
    if (!shouldShow || !news || slides !== null) return
    const unseenNews = forceMode ? news : news.filter((entry) => !seenIds?.includes(entry.id))
    // Reported as "nothing to show" while remembered-for-later, even though unseen entries
    // still exist, so the queue moves on to the next kind instead of waiting on this one.
    const hasContentToShow = unseenNews.length > 0 && (forceMode || !remindedThisLogin)
    if (reportedHasContentForRef.current !== news) {
      reportedHasContentForRef.current = news
      onHasContent?.(hasContentToShow)
    }
    if (!hasContentToShow) return

    const openTimer = window.setTimeout(() => openWithSlides(unseenNews), openDelayMs)
    return () => window.clearTimeout(openTimer)
  }, [shouldShow, forceMode, seenIds, news, slides, openWithSlides, onHasContent, openDelayMs, remindedThisLogin])

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

  const dateFnsLocale = getDateFnsLocale(locale)
  const popupSlides = slides.map((entry) => toSlide(
    entry,
    format(parseISO(entry.publishedAt), DATE_FORMAT, { locale: dateFnsLocale }),
  ))

  return (
    <ContentPopupCarousel
      open={open}
      slides={popupSlides}
      initialIndex={0}
      openKey={openKey}
      dialogTitle={t("popupTitle")}
      onClose={handleCarouselClose}
      onRemindLater={handleRemindLater}
    />
  )
}
