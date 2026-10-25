"use client"

import Link from "next/link"
import { ArrowRightIcon, WarningCircleIcon } from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"
import { hexToRgba } from "@/lib/finance-palette"

interface Props {
  label:     string
  value:     number | string
  icon:      React.ElementType
  // Without href the tile is a plain figure (e.g. the Dons page totals): same look, but no
  // link, hover or arrow — nothing to navigate to.
  href?:     string
  // In-page action instead of navigation (e.g. switching tab) — same look as a linked tile.
  // Takes precedence over href.
  onClick?:  () => void
  accent?:   string | null
  alert?:    boolean
  isLoading: boolean
  dark?:     boolean
  // Optional secondary line under the value (e.g. « 12 vendus » on the Boutique top
  // products) — muted, so the value stays the tile's one figure.
  detail?:   React.ReactNode
}

// Every tile's icon box shares this exact tint (Figma dashboard mockup: all 4 KPI
// cards use the same light-blue chip regardless of what the tile measures) — `accent`
// no longer changes it, so a tile carrying a semantic color (solde, alerte cotisations)
// still reads as part of the same row instead of standing out as a different component.
const ICON_TINT = "#023D9D"

export function StatTile({ label, value, icon: Icon, href, onClick, alert, isLoading, detail }: Props) {
  const valueContent = (
    <span className={cn("text-[1.75rem] leading-none font-medium tabular-nums", isLoading && "animate-pulse text-muted-foreground")}>
      {isLoading ? "…" : value}
    </span>
  )
  const tileContent = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-base font-medium">{label}</span>
        <span
          className="flex size-10 shrink-0 items-center justify-center rounded-lg"
          style={{ background: hexToRgba(ICON_TINT, 0.12) }}
        >
          {alert
            ? <WarningCircleIcon className="size-4.5" style={{ color: ICON_TINT }} />
            : <Icon className="size-4.5" style={{ color: ICON_TINT }} />
          }
        </span>
      </div>
      <div className="flex items-end justify-between">
        {detail !== undefined && !isLoading
          ? (
            <div className="flex flex-col gap-1.5">
              {valueContent}
              <span className="text-sm text-muted-foreground">{detail}</span>
            </div>
          )
          : valueContent
        }
        {(href || onClick) && (
          <ArrowRightIcon className="size-4 text-muted-foreground/40 opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </div>
    </>
  )
  const tileClassName = "flex flex-col justify-between gap-3 rounded-lg bg-muted/60 p-6"
  const interactiveClassName = cn("group transition-colors hover:bg-muted", tileClassName)

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cn(interactiveClassName, "w-full text-left")}>
        {tileContent}
      </button>
    )
  }
  if (!href) return <div className={tileClassName}>{tileContent}</div>
  return (
    <Link href={href} className={interactiveClassName}>
      {tileContent}
    </Link>
  )
}
