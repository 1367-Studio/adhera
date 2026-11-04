"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useLocale, useTranslations } from "next-intl"
import { format, parseISO } from "date-fns"
import { useQueryClient } from "@tanstack/react-query"
import { ContentPopupCarousel, type PopupCarouselSlide } from "@/components/layout/content-popup-carousel"
import { releaseNotesQueryOptions, useReleaseNotes, type ReleaseNote } from "@/hooks/use-help"
import { useSeenReleaseNotes } from "@/hooks/use-seen-release-notes"
import type { Locale } from "@/i18n/locales"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import { OPEN_RELEASE_NOTES_EVENT, type OpenReleaseNotesDetail } from "@/lib/help/release-notes-events"
import { useCurrentUser } from "@/lib/user-context"

// Set by the first-run guided tour (help-button.tsx). Until it exists the tour owns the
// first visit, so the pop-up waits for a later one instead of stacking on top of it.
const TOUR_SEEN_KEY  = "adhera-tour-seen-v1"
const POPUP_DELAY_MS = 1500
const DATE_FORMAT    = "d MMM yyyy"

// False on the server; the pop-up renders nothing until it has slides, so hydration still matches.
function readTourSeen() {
  if (typeof window === "undefined") return false
  try {
    return !!localStorage.getItem(TOUR_SEEN_KEY)
  } catch {
    return false
  }
}

// Testing aid: `?nouveautes=1` on any dashboard URL forces the pop-up open with every fetched
// entry, ignoring the tour key, the seen list and the `enabled` prop. Closing still marks
// entries seen as usual.
const FORCE_PARAM = "nouveautes"

function readForceMode() {
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).get(FORCE_PARAM) === "1"
}

function toSlide(note: ReleaseNote, formattedDate: string, kindLabel: string): PopupCarouselSlide {
  return {
    id:      note.id,
    heading: note.title,
    meta: (
      <>
        <time dateTime={note.publishedAt}>{formattedDate}</time>
        <span aria-hidden>·</span>
        <span>{kindLabel}</span>
      </>
    ),
    image: note.image,
    body:  note.body,
  }
}

type ReleaseNotesPopupProps = {
  enabled: boolean
  // Used only by HelpPopupQueue to sequence this pop-up against the Notícias/FAQ ones: fired
  // once per fetch with whether there is anything unseen to show, then on every actual close
  // (X button, "ne plus me rappeler", or "terminer"), so the queue knows when to move on.
  onHasContent?: (hasContent: boolean) => void
  onClose?: () => void
  // How long to wait before auto-opening. HelpPopupQueue shortens this for the 2nd/3rd pop-up
  // in a chain — the user is already mid-flow with these notifications by then, so the full
  // delay (meant to let a freshly loaded page settle before the first one) just adds wait time.
  openDelayMs?: number
}

export function ReleaseNotesPopup({ enabled, onHasContent, onClose, openDelayMs = POPUP_DELAY_MS }: ReleaseNotesPopupProps) {
  const t = useTranslations("help.releaseNotes")
  const tHelp = useTranslations("help")
  const locale = useLocale() as Locale
  const { id: currentUserId } = useCurrentUser()
  const { seenIds, markSeen } = useSeenReleaseNotes(currentUserId)
  const queryClient = useQueryClient()
  // Read once at mount, on purpose: the tour sets its key a moment after a first visit's
  // mount, and re-reading it later would pop this up on top of the running tour.
  const [tourSeen] = useState(readTourSeen)
  const [forceMode] = useState(readForceMode)
  // Frozen when the pop-up opens: marking entries seen must not reshuffle the open slides.
  // Never reset to null afterwards, which keeps the automatic open to once per visit; an open
  // requested from the bell replaces it and can happen any number of times.
  const [slides, setSlides] = useState<ReleaseNote[] | null>(null)
  const [open, setOpen] = useState(false)
  const [startIndex, setStartIndex] = useState(0)
  const [openKey, setOpenKey] = useState(0)
  // Guards onHasContent against firing twice for the same fetched list — React Strict Mode
  // double-invokes effects in dev, and onHasContent/onClose are recreated every render of the
  // queue (HelpPopupQueue), both of which can re-run this effect without `releaseNotes`
  // actually changing. A second call would double-advance the queue and skip a kind.
  const reportedHasContentForRef = useRef<ReleaseNote[] | null>(null)

  const shouldShow = forceMode || (enabled && tourSeen && seenIds !== null)
  const releaseNotesQuery = useReleaseNotes({ enabled: shouldShow })
  const releaseNotes = releaseNotesQuery.data

  const openWithSlides = useCallback((nextSlides: ReleaseNote[], nextStartIndex: number) => {
    setStartIndex(nextStartIndex)
    setSlides(nextSlides)
    setOpen(true)
    setOpenKey((key) => key + 1)
  }, [])

  // Opened from the notification bell: every fetched entry (like ?nouveautes=1, ignoring the
  // tour, `enabled` and the seen list), starting on the clicked one. fetchQuery reuses the
  // bell's cached list, and fetches it if this pop-up never needed it yet.
  useEffect(() => {
    function handleOpenRequest(event: Event) {
      const requestedNoteId = (event as CustomEvent<OpenReleaseNotesDetail>).detail?.noteId
      queryClient.fetchQuery(releaseNotesQueryOptions)
        .then((fetchedNotes) => {
          if (fetchedNotes.length === 0) return
          const requestedIndex = fetchedNotes.findIndex((releaseNote) => releaseNote.id === requestedNoteId)
          openWithSlides(fetchedNotes, Math.max(requestedIndex, 0))
        })
        .catch(() => {})
    }
    window.addEventListener(OPEN_RELEASE_NOTES_EVENT, handleOpenRequest)
    return () => window.removeEventListener(OPEN_RELEASE_NOTES_EVENT, handleOpenRequest)
  }, [queryClient, openWithSlides])

  // Clearing the timer on cleanup keeps Strict Mode's double-invoke from opening twice.
  useEffect(() => {
    if (!shouldShow || !releaseNotes || slides !== null) return
    const unseenNotes = forceMode
      ? releaseNotes
      : releaseNotes.filter((releaseNote) => !seenIds?.includes(releaseNote.id))
    if (reportedHasContentForRef.current !== releaseNotes) {
      reportedHasContentForRef.current = releaseNotes
      onHasContent?.(unseenNotes.length > 0)
    }
    if (unseenNotes.length === 0) return

    const openTimer = window.setTimeout(() => openWithSlides(unseenNotes, 0), openDelayMs)
    return () => window.clearTimeout(openTimer)
  }, [shouldShow, forceMode, seenIds, releaseNotes, slides, openWithSlides, onHasContent, openDelayMs])

  if (!slides || slides.length === 0) return null

  function handleCarouselClose(viewedIds: string[]) {
    markSeen(viewedIds)
    setOpen(false)
    onClose?.()
  }

  const dateFnsLocale = getDateFnsLocale(locale)
  const popupSlides = slides.map((note) => toSlide(
    note,
    format(parseISO(note.publishedAt), DATE_FORMAT, { locale: dateFnsLocale }),
    tHelp(`changelog.kind.${note.kind}`),
  ))

  return (
    <ContentPopupCarousel
      open={open}
      slides={popupSlides}
      initialIndex={startIndex}
      openKey={openKey}
      dialogTitle={t("title")}
      onClose={handleCarouselClose}
    />
  )
}
