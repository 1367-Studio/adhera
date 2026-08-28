"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface SegmentedControlOption<T extends string> {
  value:     T
  label:     ReactNode
  icon?:     ReactNode
  disabled?: boolean
}

interface SegmentedControlProps<T extends string> {
  options:    SegmentedControlOption<T>[]
  value:      T
  onChange:   (value: T) => void
  /** `sm` for in-form toggles, `default` for section-level switches. */
  size?:      "sm" | "default"
  disabled?:  boolean
  className?: string
}

// Single-choice segmented toggle (status, recipients, list/grid…). Same visual language
// as the shared Tabs (primary fill on the active segment and on hover) so every
// "pick one of N" control in the app reads the same way.
export function SegmentedControl<T extends string>({
  options, value, onChange, size = "default", disabled, className,
}: SegmentedControlProps<T>) {
  return (
    <div role="group" className={cn("inline-flex items-center rounded-lg border bg-muted/30 p-0.5 gap-0.5", className)}>
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          aria-pressed={value === opt.value}
          disabled={disabled || opt.disabled}
          onClick={() => onChange(opt.value)}
          className={cn(
            "flex flex-1 items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:pointer-events-none disabled:opacity-60 [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
            size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-1.5 text-sm",
            value === opt.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-primary hover:text-primary-foreground",
          )}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  )
}
