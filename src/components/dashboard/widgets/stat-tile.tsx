"use client"

import Link from "next/link"
import { ArrowRightIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"

interface Props {
  label:     string
  value:     number | string
  icon:      React.ElementType
  href:      string
  accent:    string | null
  alert?:    boolean
  isLoading: boolean
  dark:      boolean
}

// Flattened tile (CLAUDE.md §8/§11): no icon-in-a-box, no accent-colored numbers — the
// icon sits inline next to the label in muted, and only the alert state keeps its color.
export function StatTile({ label, value, icon: Icon, href, accent, alert, isLoading }: Props) {
  return (
    <Link
      href={href}
      className="group rounded-lg border bg-card p-4 flex flex-col gap-3"
    >
      <div className="flex items-center gap-2">
        {alert
          ? <WarningCircleIcon className="size-4 shrink-0" style={accent ? { color: accent } : undefined} />
          : <Icon className="size-4 shrink-0 text-muted-foreground" />
        }
        <span className="text-sm text-muted-foreground">{label}</span>
      </div>
      <div className="flex items-end justify-between">
        <span className={cn("text-2xl font-semibold tabular-nums", isLoading && "animate-pulse text-muted-foreground")}>
          {isLoading ? "…" : value}
        </span>
        <ArrowRightIcon className="size-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
      </div>
    </Link>
  )
}
