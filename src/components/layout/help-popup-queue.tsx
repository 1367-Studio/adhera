"use client"

import { useState } from "react"
import { FaqPopup } from "@/components/layout/faq-popup"
import { NewsPopup } from "@/components/layout/news-popup"
import { ReleaseNotesPopup } from "@/components/layout/release-notes-popup"

type PopupKind = "changelog" | "news" | "faq"

// Nouveautés first (product announcements), then Notícias, then FAQ tips last — editorial
// urgency order, decided with the product owner.
const QUEUE_ORDER: PopupKind[] = ["changelog", "news", "faq"]

// The 1st pop-up in a session gets the full open delay (lets a freshly loaded page settle
// before anything appears). From the 2nd one on, the user is already mid-flow with these
// notifications, so a short beat is enough — stacking the full delay again on every kind in a
// 3-deep queue adds up to real, pointless wait time.
const CHAINED_OPEN_DELAY_MS = 400

// Sequences the app-wide content pop-ups (Nouveautés, Notícias, FAQ) so at most one is ever
// open at a time, in a fixed priority order, never overlapping. The fiscal-period/subscription
// gate stays the caller's job — `enabled` here is exactly the prop that used to go straight to
// the standalone ReleaseNotesPopup before this queue existed (see dashboard/layout.tsx).
//
// Each pop-up only becomes eligible to fetch/open once it is this queue's active kind
// (`enabled={outerEnabled && isActiveKind}`); it reports back whether it had anything unseen to
// show (`onHasContent`) and when it actually closes (`onClose`), both of which advance the
// queue to the next kind. A kind with nothing to show is skipped immediately rather than
// leaving a gap in the sequence.
export function HelpPopupQueue({ enabled }: { enabled: boolean }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const activeKind = activeIndex < QUEUE_ORDER.length ? QUEUE_ORDER[activeIndex] : null

  function advance() {
    setActiveIndex((index) => index + 1)
  }

  function handleHasContent(hasContent: boolean) {
    if (!hasContent) advance()
  }

  // Only the very first kind in the queue gets the full "let the page settle" delay.
  const openDelayMs = activeIndex > 0 ? CHAINED_OPEN_DELAY_MS : undefined

  return (
    <>
      <ReleaseNotesPopup
        enabled={enabled && activeKind === "changelog"}
        onHasContent={handleHasContent}
        onClose={advance}
        openDelayMs={openDelayMs}
      />
      <NewsPopup
        enabled={enabled && activeKind === "news"}
        onHasContent={handleHasContent}
        onClose={advance}
        openDelayMs={openDelayMs}
      />
      <FaqPopup
        enabled={enabled && activeKind === "faq"}
        onHasContent={handleHasContent}
        onClose={advance}
        openDelayMs={openDelayMs}
      />
    </>
  )
}
