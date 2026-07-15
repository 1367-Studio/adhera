"use client"

import { useEffect } from "react"

// The dashboard/portal layouts already set these same CSS vars via inline `style` on
// SidebarProvider, which covers the SSR'd page content with zero flash. But modals
// (src/components/ui/dialog.tsx, Base UI's Dialog.Portal) render into document.body,
// outside that styled subtree — a dialog can only ever open after a user click, i.e.
// after hydration, so mirroring the vars onto body here has no FOUC risk and is the only
// way branded buttons inside a modal pick up the association's color instead of the
// platform default.
export function BrandStyleEffect({ vars }: { vars: Record<string, string> | undefined }) {
  useEffect(() => {
    if (!vars) return
    const { body } = document
    const previous: Record<string, string> = {}
    for (const [key, value] of Object.entries(vars)) {
      previous[key] = body.style.getPropertyValue(key)
      body.style.setProperty(key, value)
    }
    return () => {
      for (const [key, value] of Object.entries(previous)) {
        if (value) body.style.setProperty(key, value)
        else body.style.removeProperty(key)
      }
    }
  }, [vars])

  return null
}
