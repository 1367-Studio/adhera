"use client"

import { useCallback, useEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react"
import { useTranslations } from "next-intl"
import type { PortableTextBlock } from "@portabletext/react"
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
import { cn } from "@/lib/utils"

// Shared Dialog + carousel shell for the app-wide "pop up once per user, close only via the
// button" family of notification pop-ups (Nouveautés, Notícias, FAQ). Each kind is a thin
// wrapper around this component — see release-notes-popup.tsx, news-popup.tsx, faq-popup.tsx —
// supplying its own data, "seen" tracking, and per-slide content; everything below (Dialog
// wiring, autoplay, dots, keyboard navigation, footer buttons) is shared.

export type PopupCarouselSlide = {
  id:      string
  heading: string
  meta?:   ReactNode
  image?:  { url: string; alt: string | null; width: number; height: number } | null
  body?:   PortableTextBlock[] | null
}

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

function readPrefersReducedMotion() {
  if (typeof window === "undefined") return false
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

type ContentPopupCarouselProps = {
  open: boolean
  slides: PopupCarouselSlide[]
  initialIndex: number
  // Bumped by the caller every time it (re)opens the dialog with a fresh slide set — including
  // reopening on a different slide while already open (e.g. the notification bell jumping to
  // another entry). The reset effect below keys off this instead of `open` so that case still
  // re-seeds the active slide and viewed-ids tracking.
  openKey: number
  dialogTitle: string
  // Called with the ids of every slide the user actually viewed (arrived at via navigation,
  // not just the one it opened on) — on every way of closing: the X button, "Ne plus me
  // rappeler", and "Terminer" on the last slide. Backdrop clicks, Escape, and the close-watcher
  // gesture are all ignored instead of closing.
  //
  // Only the viewed slides, deliberately, even for "Ne plus me rappeler": a batch can mix
  // unrelated items (several FAQ tips flagged for pop-up at once), and marking an unseen one as
  // seen would silently bury it — it stays pending and surfaces next time instead. This has no
  // effect on "Terminer", which is only reachable after navigating through every slide, so by
  // definition every slide is already viewed by then.
  onClose: (viewedIds: string[]) => void
  // Off for content meant to be read at the user's own pace (FAQ answers) rather than skimmed
  // (short Nouveautés/Notícias blurbs). Default true.
  autoplay?: boolean
}

export function ContentPopupCarousel({
  open,
  slides,
  initialIndex,
  openKey,
  dialogTitle,
  onClose,
  autoplay = true,
}: ContentPopupCarouselProps) {
  const t = useTranslations("help.popupCarousel")
  const [prefersReducedMotion] = useState(readPrefersReducedMotion)
  const [activeIndex, setActiveIndex] = useState(initialIndex)
  // Slides can be jumped to (dots, autoplay), so "viewed" is the set of ids that were active.
  const viewedIdsRef = useRef<Set<string>>(new Set())
  // Autoplay pauses while the user is reading the band: pointer over it, focus inside it,
  // or scrolled down in it.
  const [pointerInBand, setPointerInBand] = useState(false)
  const [focusInBand, setFocusInBand] = useState(false)
  const [bandScrolled, setBandScrolled] = useState(false)
  const scrollRegionRef = useRef<HTMLDivElement>(null)
  const primaryButtonRef = useRef<HTMLButtonElement>(null)

  // Re-seeds local state whenever the caller (re)opens with a fresh slide set (openKey bump) —
  // mirrors the old openWithSlides(): "frozen" otherwise, so marking entries seen never
  // reshuffles the open slides mid-read. Also fires when reopening on a different slide while
  // already open (the notification bell jumping to another entry), since that bumps openKey too.
  useEffect(() => {
    if (slides.length === 0) return
    viewedIdsRef.current = new Set([slides[initialIndex]?.id].filter((id): id is string => !!id))
    setActiveIndex(initialIndex)
    setBandScrolled(false)
    setFocusInBand(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-seed on openKey bumps, not every slides/initialIndex identity change in between
  }, [openKey])

  useEffect(() => {
    if (scrollRegionRef.current) scrollRegionRef.current.scrollTop = 0
  }, [activeIndex])

  const goToSlide = useCallback((nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= slides.length) return
    viewedIdsRef.current.add(slides[nextIndex].id)
    // The band scrolls back to the top and its content is replaced, so the scroll and focus
    // pause flags start over. The band itself stays mounted, so the pointer flag stays accurate.
    setBandScrolled(false)
    setFocusInBand(false)
    setActiveIndex(nextIndex)
  }, [slides])

  const activeSlide = slides[Math.min(activeIndex, slides.length - 1)]
  const isAutoplayPaused = pointerInBand || focusInBand || bandScrolled

  // Restarts on every slide change, so manual navigation always gets a fresh interval. Wraps
  // to the first slide (autoplay only — "Suivant" on the last slide still means "Terminer").
  useEffect(() => {
    if (!open || !autoplay || slides.length < 2 || prefersReducedMotion || isAutoplayPaused) return
    const autoplayTimer = window.setTimeout(() => {
      goToSlide((activeIndex + 1) % slides.length)
    }, AUTOPLAY_INTERVAL_MS)
    return () => window.clearTimeout(autoplayTimer)
  }, [open, autoplay, slides, activeIndex, prefersReducedMotion, isAutoplayPaused, goToSlide])

  if (!open || slides.length === 0 || !activeSlide) return null

  const isLastSlide = activeIndex >= slides.length - 1

  // Keeps the active dot centred, except near either end where the window stops.
  const hasDotWindow = slides.length > MAX_VISIBLE_DOTS
  const dotWindowStart = hasDotWindow
    ? Math.min(Math.max(activeIndex - Math.floor(MAX_VISIBLE_DOTS / 2), 0), slides.length - MAX_VISIBLE_DOTS)
    : 0
  const dotWindowEnd = hasDotWindow ? dotWindowStart + MAX_VISIBLE_DOTS - 1 : slides.length - 1
  const hasHiddenDotsBefore = dotWindowStart > 0
  const hasHiddenDotsAfter = dotWindowEnd < slides.length - 1

  // Closes only via the X button (reason "close-press") — backdrop clicks, Escape, and the
  // close-watcher gesture are all ignored, matching the fiscal-period popup's Modal
  // `closeOnlyViaButton` behavior for this family of app-wide notification pop-ups.
  function handleOpenChange(nextOpen: boolean, eventDetails: { reason: string }) {
    if (nextOpen) return
    if (eventDetails.reason !== "close-press") return
    onClose([...viewedIdsRef.current])
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
    <Dialog open={open} onOpenChange={handleOpenChange} disablePointerDismissal>
      <DialogContent className="sm:max-w-md" initialFocus={primaryButtonRef} onKeyDown={handleKeyDown}>
        <DialogHeader className="pr-8">
          <DialogTitle className="text-base font-medium">{dialogTitle}</DialogTitle>
          {activeSlide.meta && <DialogDescription className="flex items-center gap-1.5">{activeSlide.meta}</DialogDescription>}
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
          <article key={activeSlide.id} className="flex flex-col gap-3 animate-in fade-in-0 duration-150 motion-reduce:animate-none">
            {activeSlide.image && (
              // eslint-disable-next-line @next/next/no-img-element -- Sanity CDN screenshot, resized through its own URL params
              <img
                src={`${activeSlide.image.url}?w=1024&auto=format`}
                alt={activeSlide.image.alt ?? ""}
                width={activeSlide.image.width}
                height={activeSlide.image.height}
                className="aspect-video w-full rounded-lg border border-border bg-muted object-cover object-top"
              />
            )}
            <h3 className="text-base font-medium text-foreground">{activeSlide.heading}</h3>
            {activeSlide.body && <HelpArticleView value={activeSlide.body} />}
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
                    {slides.map((slide, slideIndex) => {
                      const isActiveSlide = slideIndex === activeIndex
                      const isOutsideWindow = slideIndex < dotWindowStart || slideIndex > dotWindowEnd
                      // Smaller edge dot hints that more dots are hidden on that side.
                      const isEdgeHint = (hasHiddenDotsBefore && slideIndex === dotWindowStart)
                        || (hasHiddenDotsAfter && slideIndex === dotWindowEnd)
                      return (
                        // The focus ring sits on the dot itself so the window's overflow-hidden never clips it.
                        <button
                          key={slide.id}
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
                onClick={() => onClose([...viewedIdsRef.current])}
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
                onClick={isLastSlide ? () => onClose([...viewedIdsRef.current]) : () => goToSlide(activeIndex + 1)}
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
