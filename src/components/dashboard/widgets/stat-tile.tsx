"use client"

import Link from "next/link"
import { ArrowRightIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"
import { hexToRgba } from "@/lib/finance-palette"

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

export function StatTile({ label, value, icon: Icon, href, accent, alert, isLoading, dark }: Props) {
  return (
    <Link
      href={href}
      className="group rounded-xl border bg-card p-5 flex flex-col gap-3"
    >
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <div
          className={cn("flex size-8 items-center justify-center rounded-lg", !accent && "bg-accent")}
          style={accent ? { backgroundColor: hexToRgba(accent, dark ? 0.2 : 0.12) } : undefined}
        >
          {alert
            ? <WarningCircleIcon className="size-4" style={accent ? { color: accent } : undefined} />
            : <Icon className={cn("size-4", !accent && "text-accent-foreground")} style={accent ? { color: accent } : undefined} />
          }
        </div>
      </div>
      <div className="flex items-end justify-between">
        <span
          className={cn("text-2xl font-bold tabular-nums", isLoading && "animate-pulse text-muted-foreground")}
          style={!isLoading && accent ? { color: accent } : undefined}
        >
          {isLoading ? "…" : value}
        </span>
        <ArrowRightIcon className="size-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors" />
      </div>
    </Link>
  )
}
