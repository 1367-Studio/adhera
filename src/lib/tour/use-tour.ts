"use client"

import { useCallback } from "react"
import { useTranslations } from "next-intl"
import { driver } from "driver.js"
import "driver.js/dist/driver.css"
import { getDashboardTour, type TourStepDef } from "./steps"

/**
 * Returns a `start` callback that launches the guided dashboard tour.
 * Steps whose target element isn't in the DOM (feature disabled, hidden by
 * role/module, or collapsed sidebar) are skipped automatically, so the tour
 * adapts to whatever the current user can actually see.
 */
export function useTour() {
  const t          = useTranslations("tour")
  const tourSteps  = useTranslations("tour.steps")

  const start = useCallback((steps?: TourStepDef[]) => {
    if (typeof document === "undefined") return

    // Sidebar nav targets can live inside a closed category accordion or an
    // icon-collapsed flyout (only mounted while its dropdown is open) — force every
    // category open and the sidebar out of icon mode (see AppSidebar's
    // "adhera:expand-all-nav" listener) before querying the DOM for step targets. That
    // state update is async, so wait a tick for React to actually render it — same
    // "trigger a UI change, then delay before starting the tour" shape already used below
    // for the mobile sidebar sheet.
    window.dispatchEvent(new Event("adhera:expand-all-nav"))

    window.setTimeout(() => {
      const present = (steps ?? getDashboardTour(tourSteps)).filter(s => !s.selector || document.querySelector(s.selector))
      if (present.length === 0) return

      const driverObj = driver({
        showProgress:     true,
        allowClose:       true,
        overlayColor:     "rgba(0, 0, 0, 0.55)",
        stagePadding:     6,
        stageRadius:      8,
        popoverClass:     "adhera-tour",
        nextBtnText:      t("next"),
        prevBtnText:      t("previous"),
        doneBtnText:      t("finish"),
        progressText:     t("progress"),
        steps: present.map(s => ({
          element: s.selector || undefined,
          popover: {
            title:       s.title,
            description: s.description,
            side:        s.side,
            align:       s.align,
          },
        })),
      })

      driverObj.drive()
    }, 50)
  }, [t, tourSteps])

  return { start }
}
