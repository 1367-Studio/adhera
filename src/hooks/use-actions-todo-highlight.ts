"use client"

import { useEffect, useRef } from "react"
import { useSearchParams } from "next/navigation"

// Flashes every row the dashboard's "Actions à faire" panel (FORM-119) just linked to — same
// bg-primary/10 tint already used for the donId/commandeId single-row deep-link highlight on
// the Dons page, reused here for the whole filtered set a dashboard action lands on (there's
// no one record to point at: the filter itself is the point, and with it narrowed down every
// row in view belongs to what sent the user here).
//
// `scope` is a CSS selector for the nearest ancestor when the page renders more than one
// DataTable at once (e.g. Dons' pending + paid tables together) — leave it unset when the
// page only ever shows the one table the link points at.
export function useActionsTodoHighlight(ready: boolean, scope?: string) {
  const searchParams = useSearchParams()
  const fromActionsTodo = searchParams.get("from") === "actions-todo"
  const firedRef = useRef(false)

  useEffect(() => {
    if (!fromActionsTodo || !ready || firedRef.current) return
    firedRef.current = true

    const root = scope ? document.querySelector(scope) : document
    const els = root ? ([...root.querySelectorAll("[data-row-id]")] as HTMLElement[]) : []
    if (!els.length) return

    els.forEach(el => el.classList.add("bg-primary/10"))
    const timeout = setTimeout(() => els.forEach(el => el.classList.remove("bg-primary/10")), 2500)
    return () => clearTimeout(timeout)
  }, [fromActionsTodo, ready, scope])
}
