import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

// Shown only while editing, when a block still misses its main content (no image, invalid
// video link…). The public site renders nothing instead.
export function SiteEditingPlaceholder({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn("flex min-h-32 items-center justify-center px-4 py-8 text-center text-sm", className)}
      style={{
        background:   "var(--site-surface-muted)",
        border:       "1px dashed var(--site-border)",
        borderRadius: "var(--site-radius)",
        color:        "var(--site-text-muted)",
      }}
    >
      {children}
    </div>
  )
}
