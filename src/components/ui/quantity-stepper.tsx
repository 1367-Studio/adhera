"use client"

import { MinusIcon, PlusIcon } from "@phosphor-icons/react/dist/ssr"

export function QuantityStepper({
  value,
  onChange,
  max,
  label,
}: {
  value:    number
  onChange: (v: number) => void
  max:      number
  label:    string
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground flex-1">{label}</span>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onChange(Math.max(1, value - 1))}
          disabled={value <= 1}
          className="flex size-6 items-center justify-center rounded border border-input bg-background text-muted-foreground disabled:opacity-40 transition-colors"
        >
          <MinusIcon className="size-3" />
        </button>
        <span className="w-5 text-center text-sm font-medium tabular-nums">{value}</span>
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1))}
          disabled={value >= max}
          className="flex size-6 items-center justify-center rounded border border-input bg-background text-muted-foreground disabled:opacity-40 transition-colors"
        >
          <PlusIcon className="size-3" />
        </button>
      </div>
    </div>
  )
}
