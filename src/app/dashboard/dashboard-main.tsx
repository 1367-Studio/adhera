"use client"

import type { ReactNode } from "react"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"

// Routes that manage their own height/scroll and want the full dashboard canvas — the standard
// gap-4/p-4 would double-count space a page has already sized itself around. The Puck site
// builder sizes to calc(100dvh - 3.5rem), assuming only the header above it (see EDITOR_HEIGHT
// in site-puck-editor.tsx); the extra p-4 was fighting that and forcing an inner scrollbar.
const FULL_BLEED_PREFIXES = ["/dashboard/site/puck"]

export function DashboardMain({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const isFullBleed = FULL_BLEED_PREFIXES.some(prefix => pathname.startsWith(prefix))

  return (
    <main
      className={cn(
        "flex min-h-0 flex-1 flex-col scroll-pt-4 md:overflow-y-auto animate-in fade-in duration-200",
        isFullBleed ? "" : "gap-4 p-4",
      )}
      style={{ animationFillMode: "both" }}
    >
      {children}
    </main>
  )
}
