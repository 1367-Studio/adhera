"use client"

import { useId, type ReactNode } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface ColorFieldProps {
  /** Text-field value — the hex the user sees and can type over. May be "" (see `fallbackColor`). */
  value:           string
  onChange:        (color: string) => void
  label?:          ReactNode
  description?:    string
  placeholder?:    string
  disabled?:       boolean
  /**
   * What the native swatch shows when `value` is empty. The OS colour picker has no empty
   * state — it always displays *some* colour — so a field whose value is optional passes the
   * colour it falls back to, instead of the picker silently defaulting to black.
   */
  fallbackColor?:  string
  /** `sm` (h-8) inside the compact site builder panel, `default` (h-9) on settings screens. */
  size?:           "sm" | "default"
  className?:      string
}

// The swatch + hex input pair used wherever an admin picks a colour (site builder, section
// backgrounds, member card). Was hand-written in three places with three different swatch
// sizes; sharing it keeps the swatch square, the hex monospaced and — the part that kept
// drifting — the two controls the same height as everything else in their row (CLAUDE.md §3).
export function ColorField({
  value, onChange, label, description, placeholder, disabled,
  fallbackColor = "#000000", size = "default", className,
}: ColorFieldProps) {
  const textInputId = useId()
  const isSmall     = size === "sm"

  return (
    <div className={cn("space-y-1.5", className)}>
      {label && <Label id={`${textInputId}-label`} htmlFor={textInputId} className="text-xs">{label}</Label>}
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value || fallbackColor}
          onChange={event => onChange(event.target.value)}
          disabled={disabled}
          // Labelled by the same label as the hex field: both controls edit one value, and a
          // colour input with no accessible name is unusable with a screen reader.
          aria-labelledby={label ? `${textInputId}-label` : undefined}
          className={cn(
            "shrink-0 cursor-pointer rounded-md border p-0.5 disabled:pointer-events-none disabled:opacity-50",
            isSmall ? "size-8" : "size-9",
          )}
        />
        <Input
          id={textInputId}
          value={value}
          onChange={event => onChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={cn("font-mono", isSmall ? "h-8 text-xs" : "text-sm")}
        />
      </div>
    </div>
  )
}
