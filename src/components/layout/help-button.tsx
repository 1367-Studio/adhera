"use client"

import { useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { useTranslations } from "next-intl"
import { QuestionIcon } from "@phosphor-icons/react/dist/ssr";
import { useTour } from "@/lib/tour/use-tour"
import { useSidebar } from "@/components/ui/sidebar"

// The panel (Portable Text renderer, assistant, tabs, accordion) only loads the first time
// someone opens it — the header is on every dashboard page, most of which never need help.
const HelpPanel = dynamic(() => import("@/components/help/help-panel").then((module) => module.HelpPanel), { ssr: false })

/** Bump the suffix to re-show the tour to everyone after a major update. */
const SEEN_KEY = "adhera-tour-seen-v1"

export function HelpButton() {
  const t = useTranslations("help")
  const { start } = useTour()
  const { isMobile, setOpenMobile } = useSidebar()
  const [open, setOpen] = useState(false)
  const [hasOpened, setHasOpened] = useState(false)
  // Set when "Visite guidée" is clicked in the panel; consumed once the sheet has finished
  // closing, so driver.js never highlights targets behind a modal backdrop or focus trap.
  const tourRequestedRef = useRef(false)

  // Launch the tour. On mobile the sidebar is a closed sheet, so open it first
  // and give it a moment to render before highlighting the nav items.
  const launch = () => {
    if (isMobile) {
      setOpenMobile(true)
      window.setTimeout(() => start(), 400)
    } else {
      start()
    }
  }

  // Auto-start once for first-time users. The localStorage flag provides the
  // "once ever" guarantee; clearing the timer on cleanup keeps Strict Mode's
  // double-invoke from launching twice (the surviving mount reschedules).
  useEffect(() => {
    if (typeof window === "undefined") return
    if (localStorage.getItem(SEEN_KEY)) return

    const autoStartTimer = window.setTimeout(() => {
      localStorage.setItem(SEEN_KEY, "1")
      launch()
    }, 900)
    return () => window.clearTimeout(autoStartTimer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function openPanel() {
    setHasOpened(true)
    setOpen(true)
  }

  function requestTourFromPanel() {
    tourRequestedRef.current = true
    setOpen(false)
  }

  function handleCloseComplete() {
    if (!tourRequestedRef.current) return
    tourRequestedRef.current = false
    launch()
  }

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        data-tour="help"
        className="flex items-center justify-center rounded-md h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
        aria-label={t("buttonLabel")}
        aria-haspopup="dialog"
        aria-expanded={open}
        title={t("buttonLabel")}
      >
        <QuestionIcon className="size-4" />
      </button>

      {hasOpened && (
        <HelpPanel
          open={open}
          onOpenChange={setOpen}
          onStartTour={requestTourFromPanel}
          onCloseComplete={handleCloseComplete}
        />
      )}
    </>
  )
}
