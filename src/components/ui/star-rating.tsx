"use client"

import { StarIcon } from "@phosphor-icons/react/dist/ssr"
import { cn } from "@/lib/utils"

const FILLED = "#f59e0b"

// Interactive star picker (1-5), used for submitting a rating. For a read-only display of
// an existing rating (e.g. an average shown in the admin panel), use <StarRatingDisplay>.
export function StarRating({
  value,
  onChange,
  size = "md",
}: {
  value:    number
  onChange: (v: number) => void
  size?:    "sm" | "md"
}) {
  const iconSize = size === "sm" ? "size-5" : "size-8"
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange(star)}
          className="p-0.5 focus:outline-none"
          aria-label={`${star} étoile${star > 1 ? "s" : ""}`}
        >
          <StarIcon
            className={cn(iconSize, "transition-colors")}
            fill={star <= value ? FILLED : "transparent"}
            stroke={star <= value ? FILLED : "currentColor"}
          />
        </button>
      ))}
    </div>
  )
}

// Read-only, for showing an existing or average rating. `value` may be fractional (an
// average) — stars fill proportionally rather than snapping to whole stars.
export function StarRatingDisplay({
  value,
  size = "sm",
}: {
  value: number
  size?: "sm" | "md"
}) {
  const iconSize = size === "sm" ? "size-4" : "size-5"
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => {
        const fillRatio = Math.max(0, Math.min(1, value - (star - 1)))
        return (
          <span key={star} className="relative inline-block">
            <StarIcon className={cn(iconSize, "text-muted-foreground/30")} weight="fill" />
            {fillRatio > 0 && (
              <span
                className="absolute inset-0 overflow-hidden"
                style={{ width: `${fillRatio * 100}%` }}
              >
                <StarIcon className={iconSize} style={{ color: FILLED }} weight="fill" />
              </span>
            )}
          </span>
        )
      })}
    </div>
  )
}
