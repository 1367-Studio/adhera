"use client"

import type { ReactNode } from "react"
import { SegmentedControl } from "@/components/ui/segmented-control"

interface ViewToggleOption<T extends string> {
  value: T
  label: string
  icon?: ReactNode
}

interface ViewToggleProps<T extends string> {
  options: ViewToggleOption<T>[]
  value:   T
  onChange: (value: T) => void
}

// Compact list/grid switcher — just the shared SegmentedControl at its small size.
// Kept at its natural width and scrolled sideways when the header is narrower than the
// options (e.g. the five Paramètres tabs on a phone) instead of being clipped off-screen.
export function ViewToggle<T extends string>(props: ViewToggleProps<T>) {
  return (
    <div className="no-scrollbar max-w-full overflow-x-auto">
      <SegmentedControl size="sm" className="w-max" {...props} />
    </div>
  )
}
