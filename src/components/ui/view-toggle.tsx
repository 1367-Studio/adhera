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
export function ViewToggle<T extends string>(props: ViewToggleProps<T>) {
  return <SegmentedControl size="sm" {...props} />
}
