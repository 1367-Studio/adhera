"use client"

import { useCallback } from "react"
import { driver } from "driver.js"
import "driver.js/dist/driver.css"
import { dashboardTour, type TourStepDef } from "./steps"

/**
 * Returns a `start` callback that launches the guided dashboard tour.
 * Steps whose target element isn't in the DOM (feature disabled, hidden by
 * role/module, or collapsed sidebar) are skipped automatically, so the tour
 * adapts to whatever the current user can actually see.
 */
export function useTour() {
  const start = useCallback((steps: TourStepDef[] = dashboardTour) => {
    if (typeof document === "undefined") return

    const present = steps.filter(s => !s.selector || document.querySelector(s.selector))
    if (present.length === 0) return

    const driverObj = driver({
      showProgress:     true,
      allowClose:       true,
      overlayColor:     "rgba(0, 0, 0, 0.55)",
      stagePadding:     6,
      stageRadius:      8,
      popoverClass:     "adhera-tour",
      nextBtnText:      "Suivant",
      prevBtnText:      "Précédent",
      doneBtnText:      "Terminer",
      progressText:     "{{current}} / {{total}}",
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
  }, [])

  return { start }
}
