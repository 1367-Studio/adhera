"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { format } from "date-fns"
import { CalendarBlankIcon, XIcon } from "@phosphor-icons/react/dist/ssr"

import { Calendar } from "@/components/ui/calendar"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { InfoIcon } from "@phosphor-icons/react/dist/ssr"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import type { Locale } from "@/i18n/locales"
import { cn } from "@/lib/utils"

// A YYYY-MM-DD string parsed with `new Date(s)` is read as UTC midnight, so anyone in a
// timezone behind UTC gets the previous day back — the same class of bug that made event
// confirmation emails announce the wrong hour. Both directions therefore go through the
// local calendar fields explicitly and never through Date's string parsing or toISOString().
export function parseValue(value: string | null | undefined): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const [y, m, d] = value.split("-").map(Number)
  const date = new Date(y, m - 1, d)
  // Rejects impossible dates that Date would silently roll over (2026-02-31 → March 3rd).
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : undefined
}

export function toValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// For callers building a min/max bound. `new Date().toISOString().split("T")[0]` is the
// obvious way to write "today" and is wrong east of Greenwich for the first hours of the
// day, where it still returns yesterday.
export function todayValue(): string {
  return toValue(new Date())
}

// react-day-picker's dropdown caption defaults to "100 years back → end of the current
// year", which silently puts every future date out of reach — next year's exercice, an event
// booked two years out. So the bounds are always explicit: the caller's min/max when it sets
// them, otherwise a window wide enough for both a birth date and a forward-dated season.
export const YEARS_BACK  = 100
export const YEARS_AHEAD = 10

export interface DateFieldProps {
  label?:    string
  value:     string | null | undefined
  // Always a YYYY-MM-DD string, or "" when cleared — byte-for-byte what an
  // `<input type="date">` produces, so every zod schema and API route this replaces keeps
  // working untouched. That contract is the whole reason this is a drop-in.
  onChange:  (value: string) => void
  required?: boolean
  disabled?: boolean
  error?:    string
  hint?:     string
  // Same role as `hint`, but behind an info icon on the label instead of inline underneath —
  // mirrors FormField, so a field keeps its tooltip when it migrates over from there.
  hintTooltip?: string
  // YYYY-MM-DD bounds, same meaning as the native input's min/max. An explicit `max` always
  // wins over the no-future default below.
  min?:      string
  max?:      string
  // Opens the future up. Off by default because most dates in this product record something
  // that already happened — a birth date, a payment, a cheque, a hand-over — and offering
  // tomorrow there only invites a typo nobody catches until it lands in an export.
  // Set it wherever a future date is the point: an event, a deadline, a return date, a
  // fiscal year being opened ahead of time.
  allowFuture?: boolean
  id?:       string
  placeholder?: string
  className?:   string
  // Hidden when the field is required — clearing it would only produce a value the form is
  // about to reject anyway.
  clearable?: boolean
}

export function DateField({
  label, value, onChange, required, disabled, error, hint, hintTooltip,
  min, max, allowFuture, id, placeholder, className, clearable = true,
}: DateFieldProps) {
  const t       = useTranslations("common")
  const locale  = useLocale() as Locale
  const dfLocale = getDateFnsLocale(locale)
  const [open, setOpen] = React.useState(false)

  const reactId  = React.useId()
  const fieldId  = id ?? reactId
  const selected = parseValue(value)
  const showClear = clearable && !required && !disabled && !!selected

  const today   = React.useMemo(() => parseValue(todayValue())!, [])
  const minDate = parseValue(min)
  // An explicit max wins; otherwise today closes the field unless the caller opened the
  // future. Both the dropdowns and the day grid read from this one value, so they can never
  // disagree about what is reachable.
  const maxDate = parseValue(max) ?? (allowFuture ? undefined : today)

  const thisYear   = today.getFullYear()
  const startMonth = minDate ?? new Date(thisYear - YEARS_BACK, 0, 1)
  const endMonth   = maxDate ?? new Date(thisYear + YEARS_AHEAD, 11, 31)

  // Lands on the selected date's month, else on today — and if today falls outside the
  // allowed window (a max in the past, a min in the future), on the nearest allowed edge
  // rather than on an empty month the user cannot pick anything in.
  const defaultMonth =
    selected                  ? selected
    : today < startMonth      ? startMonth
    : today > endMonth        ? endMonth
    :                           today

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <div className="flex items-center gap-1.5">
          <Label htmlFor={fieldId} className={cn(error && "text-destructive")}>
            {label}
            {required && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}
          </Label>
          {hintTooltip && (
            <Tooltip>
              <TooltipTrigger className="text-muted-foreground hover:text-foreground" aria-labelledby={`${fieldId}-hint`}>
                <InfoIcon className="size-3.5" />
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-64 whitespace-normal text-left">
                <span id={`${fieldId}-hint`}>{hintTooltip}</span>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )}

      <div className="relative">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            id={fieldId}
            disabled={disabled}
            aria-invalid={!!error}
            aria-describedby={error ? `${fieldId}-error` : (hint || hintTooltip) ? `${fieldId}-hint` : undefined}
            // Mirrors ui/input's own classes rather than using a Button variant: this reads
            // as a form control, so it must line up with every Input beside it — same h-9,
            // same radius, same border, same focus ring, same disabled and invalid states.
            className={cn(
              "flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-transparent px-3 py-1 text-left text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80",
              error && "border-destructive focus-visible:ring-destructive/30",
              showClear && "pr-9",
              className,
            )}
          >
            <CalendarBlankIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className={cn("truncate", !selected && "text-muted-foreground")}>
              {selected ? format(selected, "d MMM yyyy", { locale: dfLocale }) : (placeholder ?? t("datePlaceholder"))}
            </span>
          </PopoverTrigger>

          <PopoverContent align="start" className="w-auto p-0">
            <Calendar
              mode="single"
              selected={selected}
              defaultMonth={defaultMonth}
              locale={dfLocale}
              // Month and year as dropdowns rather than the ‹ › arrows alone: reaching 1962
              // from today is 768 clicks on arrows, and a date of birth is the single most
              // common thing this field is used for.
              captionLayout="dropdown"
              startMonth={startMonth}
              endMonth={endMonth}
              // Bounds the *selectable* days. startMonth/endMonth above only bound what the
              // dropdowns offer, so without this a day outside min/max in a reachable month
              // would still be clickable.
              disabled={[
                ...(minDate ? [{ before: minDate }] : []),
                ...(maxDate ? [{ after:  maxDate }] : []),
              ]}
              // Focus starts on the selected day, or on today when the field is empty — so
              // opening the picker and pressing Enter is always a meaningful action.
              autoFocus
              onSelect={(date) => {
                if (!date) return
                onChange(toValue(date))
                setOpen(false)
              }}
            />
          </PopoverContent>
        </Popover>

        {showClear && (
          // Outside the trigger, not nested in it: a button inside a button is invalid
          // markup and the inner click would open the popover on its way out.
          <button
            type="button"
            tabIndex={-1}
            aria-label={t("clear")}
            onClick={() => onChange("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <XIcon className="size-3.5" />
          </button>
        )}
      </div>

      {error && <p id={`${fieldId}-error`} className="text-xs text-destructive">{error}</p>}
      {!error && hint && <p id={`${fieldId}-hint`} className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
