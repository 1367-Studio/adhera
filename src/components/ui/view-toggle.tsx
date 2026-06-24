"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

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

export function ViewToggle<T extends string>({ options, value, onChange }: ViewToggleProps<T>) {
  return (
    <div className="flex items-center rounded-lg border bg-muted/30 p-0.5 gap-0.5">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors",
            value === opt.value
              ? "bg-background shadow-sm text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  )
}
