"use client"

import { useEffect } from "react"
import { HelpCircleIcon } from "lucide-react"
import { useTour } from "@/lib/tour/use-tour"
import { useSidebar } from "@/components/ui/sidebar"

/** Bump the suffix to re-show the tour to everyone after a major update. */
const SEEN_KEY = "adhera-tour-seen-v1"

export function HelpButton() {
  const { start } = useTour()
  const { isMobile, setOpenMobile } = useSidebar()

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

    const t = window.setTimeout(() => {
      localStorage.setItem(SEEN_KEY, "1")
      launch()
    }, 900)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <button
      type="button"
      onClick={launch}
      data-tour="help"
      className="flex items-center justify-center rounded-md h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
      aria-label="Aide et visite guidée"
      title="Visite guidée"
    >
      <HelpCircleIcon className="size-4" />
    </button>
  )
}
