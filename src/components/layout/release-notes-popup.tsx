"use client"

import { useCallback, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react"
import { useLocale, useTranslations } from "next-intl"
import { format, parseISO } from "date-fns"
import { useQueryClient } from "@tanstack/react-query"
import { HelpArticleView } from "@/components/help/help-article-view"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { releaseNotesQueryOptions, useReleaseNotes, type ReleaseNote } from "@/hooks/use-help"
import { useSeenReleaseNotes } from "@/hooks/use-seen-release-notes"
import type { Locale } from "@/i18n/locales"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import { OPEN_RELEASE_NOTES_EVENT, type OpenReleaseNotesDetail } from "@/lib/help/release-notes-events"
import { cn } from "@/lib/utils"

// Set by the first-run guided tour (help-button.tsx). Until it exists the tour owns the
// first visit, so the pop-up waits for a later one instead of stacking on top of it.
const TOUR_SEEN_KEY  = "adhera-tour-seen-v1"
const POPUP_DELAY_MS = 1500
const DATE_FORMAT    = "d MMM yyyy"
const AUTOPLAY_INTERVAL_MS = 5000
// Past this many slides the dots become a sliding window (Instagram-style) so the footer never
// grows. Each dot button is size-4 with no gap, so one step is exactly 1rem and the window
// viewport is w-20 (5 × 1rem) — keep the three in sync.
const MAX_VISIBLE_DOTS = 5
const DOT_STEP_REM     = 1

function isEditableElement(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
}

// False on the server; the pop-up renders nothing until it has slides, so hydration still matches.
function readTourSeen() {
  if (typeof window === "undefined") return false
  try {
    return !!localStorage.getItem(TOUR_SEEN_KEY)
  } catch {
    return false
  }
}

// Autoplay is motion, so it is off for users who asked the system to reduce it.
function readPrefersReducedMotion() {
  if (typeof window === "undefined") return false
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

// Testing aid: `?nouveautes=1` on any dashboard URL forces the pop-up open with every fetched
// entry, ignoring the tour key, the seen list and the `enabled` prop. Closing still marks
// entries seen as usual.
const FORCE_PARAM = "nouveautes"

function readForceMode() {
  if (typeof window === "undefined") return false
  return new URLSearchParams(window.location.search).get(FORCE_PARAM) === "1"
}

export function ReleaseNotesPopup({ enabled }: { enabled: boolean }) {
  const t = useTranslations("help.releaseNotes")
  const tHelp = useTranslations("help")
  const locale = useLocale() as Locale
  const { seenIds, markSeen } = useSeenReleaseNotes()
  const queryClient = useQueryClient()
  // Read once at mount, on purpose: the tour sets its key a moment after a first visit's
  // mount, and re-reading it later would pop this up on top of the running tour.
  const [tourSeen] = useState(readTourSeen)
  const [forceMode] = useState(readForceMode)
  const [prefersReducedMotion] = useState(readPrefersReducedMotion)
  // Frozen when the pop-up opens: marking entries seen must not reshuffle the open slides.
  // Never reset to null afterwards, which keeps the automatic open to once per visit; an open
  // requested from the bell replaces it and can happen any number of times.
  const [slides, setSlides] = useState<ReleaseNote[] | null>(null)
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  // Slides can be jumped to (dots, autoplay), so "viewed" is the set of ids that were active.
  const viewedIdsRef = useRef<Set<string>>(new Set())
  // Autoplay pauses while the user is reading the band: pointer over it, focus inside it,
  // or scrolled down in it.
  const [pointerInBand, setPointerInBand] = useState(false)
  const [focusInBand, setFocusInBand] = useState(false)
  const [bandScrolled, setBandScrolled] = useState(false)
  const scrollRegionRef = useRef<HTMLDivElement>(null)
  const primaryButtonRef = useRef<HTMLButtonElement>(null)

  const shouldShow = forceMode || (enabled && tourSeen && seenIds !== null)
  const releaseNotesQuery = useReleaseNotes({ enabled: shouldShow })
  const releaseNotes = releaseNotesQuery.data

  const openWithSlides = useCallback((nextSlides: ReleaseNote[], startIndex: number) => {
    viewedIdsRef.current = new Set([nextSlides[startIndex].id])
    setBandScrolled(false)
    setFocusInBand(false)
    setActiveIndex(startIndex)
    setSlides(nextSlides)
    setOpen(true)
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
    if (unseenNotes.length === 0) return

    const openTimer = window.setTimeout(() => openWithSlides(unseenNotes, 0), POPUP_DELAY_MS)
    return () => window.clearTimeout(openTimer)
  }, [shouldShow, forceMode, seenIds, releaseNotes, slides, openWithSlides])

  useEffect(() => {
    if (scrollRegionRef.current) scrollRegionRef.current.scrollTop = 0
  }, [activeIndex])

  const goToSlide = useCallback((nextIndex: number) => {
    if (!slides || nextIndex < 0 || nextIndex >= slides.length) return
    viewedIdsRef.current.add(slides[nextIndex].id)
    // The band scrolls back to the top and its content is replaced, so the scroll and focus
    // pause flags start over. The band itself stays mounted, so the pointer flag stays accurate.
    setBandScrolled(false)
    setFocusInBand(false)
    setActiveIndex(nextIndex)
  }, [slides])

  const activeNote = slides?.[Math.min(activeIndex, slides.length - 1)]
  const isAutoplayPaused = pointerInBand || focusInBand || bandScrolled

  // Restarts on every slide change, so manual navigation always gets a fresh interval. Wraps
  // to the first slide (autoplay only — "Suivant" on the last slide still means "Terminer").
  useEffect(() => {
    if (!open || !slides || slides.length < 2 || prefersReducedMotion || isAutoplayPaused) return
    const autoplayTimer = window.setTimeout(() => {
      goToSlide((activeIndex + 1) % slides.length)
    }, AUTOPLAY_INTERVAL_MS)
    return () => window.clearTimeout(autoplayTimer)
  }, [open, slides, activeIndex, prefersReducedMotion, isAutoplayPaused, goToSlide])

  if (!slides || slides.length === 0 || !activeNote) return null

  const isLastSlide = activeIndex >= slides.length - 1

  // Keeps the active dot centred, except near either end where the window stops.
  const hasDotWindow = slides.length > MAX_VISIBLE_DOTS
  const dotWindowStart = hasDotWindow
    ? Math.min(Math.max(activeIndex - Math.floor(MAX_VISIBLE_DOTS / 2), 0), slides.length - MAX_VISIBLE_DOTS)
    : 0
  const dotWindowEnd = hasDotWindow ? dotWindowStart + MAX_VISIBLE_DOTS - 1 : slides.length - 1
  const hasHiddenDotsBefore = dotWindowStart > 0
  const hasHiddenDotsAfter = dotWindowEnd < slides.length - 1

  function closeMarkingViewed() {
    markSeen([...viewedIdsRef.current])
    setOpen(false)
  }

  function closeMarkingAll() {
    if (!slides) return
    markSeen(slides.map((releaseNote) => releaseNote.id))
    setOpen(false)
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) closeMarkingViewed()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (isEditableElement(event.target)) return
    if (event.key === "ArrowRight") {
      event.preventDefault()
      goToSlide(activeIndex + 1)
    } else if (event.key === "ArrowLeft") {
      event.preventDefault()
      goToSlide(activeIndex - 1)
    }
  }

  function handleBandBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setFocusInBand(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md" initialFocus={primaryButtonRef} onKeyDown={handleKeyDown}>
        <DialogHeader className="pr-8">
          <DialogTitle className="text-base font-medium">{t("title")}</DialogTitle>
          <DialogDescription className="flex items-center gap-1.5">
            <time dateTime={activeNote.publishedAt}>
              {format(parseISO(activeNote.publishedAt), DATE_FORMAT, { locale: getDateFnsLocale(locale) })}
            </time>
            <span aria-hidden>·</span>
            <span>{tHelp(`changelog.kind.${activeNote.kind}`)}</span>
          </DialogDescription>
        </DialogHeader>

        {/* Full-bleed band touching the footer: -mb-4 cancels DialogContent's gap-4 below it.
            Fixed height (the header is static too) so the dialog never resizes between slides;
            min-h-0 still lets it shrink on very short viewports. */}
        <div
          ref={scrollRegionRef}
          className="-mx-4 -mb-4 h-80 min-h-0 overflow-y-auto border-t bg-muted/50 px-4 py-4"
          onPointerEnter={() => setPointerInBand(true)}
          onPointerLeave={() => setPointerInBand(false)}
          onFocus={() => setFocusInBand(true)}
          onBlur={handleBandBlur}
          onScroll={(event) => setBandScrolled(event.currentTarget.scrollTop > 0)}
        >
          <article key={activeNote.id} className="flex flex-col gap-3 animate-in fade-in-0 duration-150 motion-reduce:animate-none">
            {activeNote.image && (
              // eslint-disable-next-line @next/next/no-img-element -- Sanity CDN screenshot, resized through its own URL params
              <img
                src={`${activeNote.image.url}?w=1024&auto=format`}
                alt={activeNote.image.alt ?? ""}
                width={activeNote.image.width}
                height={activeNote.image.height}
                className="aspect-video w-full rounded-lg border border-border bg-muted object-cover object-top"
              />
            )}
            <h3 className="text-base font-medium text-foreground">{activeNote.title}</h3>
            {activeNote.body && <HelpArticleView value={activeNote.body} />}
          </article>
        </div>

        <DialogFooter className="bg-transparent">
          <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {slides.length >= 2 && (
              <>
                <div className={cn("overflow-hidden", hasDotWindow && "w-20")}>
                  <div
                    className="flex transition-transform duration-200 ease-out motion-reduce:transition-none"
                    style={hasDotWindow ? { transform: `translateX(-${dotWindowStart * DOT_STEP_REM}rem)` } : undefined}
                  >
                    {slides.map((releaseNote, slideIndex) => {
                      const isActiveSlide = slideIndex === activeIndex
                      const isOutsideWindow = slideIndex < dotWindowStart || slideIndex > dotWindowEnd
                      // Smaller edge dot hints that more dots are hidden on that side.
                      const isEdgeHint = (hasHiddenDotsBefore && slideIndex === dotWindowStart)
                        || (hasHiddenDotsAfter && slideIndex === dotWindowEnd)
                      return (
                        // The focus ring sits on the dot itself so the window's overflow-hidden never clips it.
                        <button
                          key={releaseNote.id}
                          type="button"
                          className="group flex size-4 shrink-0 items-center justify-center rounded-full outline-none"
                          aria-label={t("goTo", { index: slideIndex + 1 })}
                          aria-current={isActiveSlide ? "true" : undefined}
                          aria-hidden={isOutsideWindow || undefined}
                          tabIndex={isOutsideWindow ? -1 : undefined}
                          onClick={() => goToSlide(slideIndex)}
                        >
                          <span
                            className={cn(
                              "block rounded-full group-focus-visible:ring-3 group-focus-visible:ring-ring/50",
                              isEdgeHint ? "size-1" : "size-1.5",
                              isActiveSlide ? "bg-primary" : "bg-muted-foreground/30 group-hover:bg-muted-foreground/60",
                            )}
                          />
                        </button>
                      )
                    })}
                  </div>
                </div>
                <span className="sr-only" aria-live="polite">
                  {t("position", { current: activeIndex + 1, total: slides.length })}
                </span>
              </>
            )}
            <div className="flex flex-wrap gap-2 sm:ml-auto sm:flex-nowrap">
              {/* On mobile the dismiss action drops to its own full-width row under the navigation. */}
              <Button
                type="button"
                variant="ghost"
                className="order-last basis-full sm:order-none sm:basis-auto"
                onClick={closeMarkingAll}
              >
                {t("dontRemind")}
              </Button>
              {/* Always rendered so the mobile button row keeps the same shape on every slide:
                  on the first slide it is invisible on mobile (keeps its space) and gone from sm up. */}
              <Button
                type="button"
                variant="outline"
                className={cn("flex-1 sm:flex-none", activeIndex === 0 && "invisible sm:hidden")}
                disabled={activeIndex === 0}
                onClick={() => goToSlide(activeIndex - 1)}
              >
                {t("previous")}
              </Button>
              <Button
                ref={primaryButtonRef}
                type="button"
                className="flex-1 sm:flex-none"
                onClick={isLastSlide ? closeMarkingAll : () => goToSlide(activeIndex + 1)}
              >
                {isLastSlide ? t("finish") : t("next")}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
