"use client"

import * as React from "react"
import { useLocale, useTranslations } from "next-intl"
import { format } from "date-fns"
import { CalendarBlankIcon, ClockIcon, XIcon } from "@phosphor-icons/react/dist/ssr"

import { Calendar } from "@/components/ui/calendar"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { parseValue, toValue, todayValue, YEARS_BACK, YEARS_AHEAD } from "@/components/ui/date-field"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import type { Locale } from "@/i18n/locales"
import { cn } from "@/lib/utils"

// The time a date-only pick lands on when the field was empty. Deliberately a round working
// hour rather than "now": a meeting created at 14:37 should not default to 14:37.
const DEFAULT_TIME = "09:00"

// datetime-local's own wire format, which this component reproduces byte for byte so it can
// replace an <input type="datetime-local"> without touching a single schema or route. The
// value carries no timezone — it is wall-clock time, exactly as the native input treats it
// (see the note in evenements-view about why that matters for events).
function splitValue(value: string | null | undefined): { date: string; time: string } {
  // The time half is optional on the way in: a stored value that lost its time (or a caller
  // handing over a plain date) still shows its date rather than rendering as an empty field.
  // Seconds are accepted and dropped — the native input never produced them either.
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/.exec(value ?? "")
  return m ? { date: m[1], time: m[2] ?? "" } : { date: "", time: "" }
}

function joinValue(date: string, time: string): string {
  return date ? `${date}T${time || DEFAULT_TIME}` : ""
}

export interface DateTimeFieldProps {
  label?:    string
  // A "YYYY-MM-DDTHH:mm" string, or "" when cleared.
  value:     string | null | undefined
  onChange:  (value: string) => void
  required?: boolean
  disabled?: boolean
  error?:    string
  hint?:     string
  // Accepts either a plain date or a full datetime; only the date half bounds the calendar.
  min?:      string
  max?:      string
  id?:       string
  placeholder?: string
  className?:   string
  clearable?:   boolean
  // Same meaning and same default as DateField's: off unless the caller says otherwise, so
  // the two components never disagree about what a bare field allows.
  allowFuture?: boolean
}

export function DateTimeField({
  label, value, onChange, required, disabled, error, hint,
  min, max, allowFuture, id, placeholder, className, clearable = true,
}: DateTimeFieldProps) {
  const t        = useTranslations("common")
  const locale   = useLocale() as Locale
  const dfLocale = getDateFnsLocale(locale)
  const [open, setOpen] = React.useState(false)

  const reactId = React.useId()
  const fieldId = id ?? reactId

  const { date, time } = splitValue(value)
  const selected  = parseValue(date)
  const showClear = clearable && !required && !disabled && !!selected

  const today   = React.useMemo(() => parseValue(todayValue())!, [])
  const minDate = parseValue(splitValue(min).date || min)
  const maxDate = parseValue(splitValue(max).date || max) ?? (allowFuture ? undefined : today)

  const thisYear   = today.getFullYear()
  const startMonth = minDate ?? new Date(thisYear - YEARS_BACK, 0, 1)
  const endMonth   = maxDate ?? new Date(thisYear + YEARS_AHEAD, 11, 31)
  const defaultMonth =
    selected             ? selected
    : today < startMonth ? startMonth
    : today > endMonth   ? endMonth
    :                      today

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <Label htmlFor={fieldId} className={cn(error && "text-destructive")}>
          {label}
          {required && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}
        </Label>
      )}

      <div className="relative">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            id={fieldId}
            disabled={disabled}
            aria-invalid={!!error}
            aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
            className={cn(
              "flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-transparent px-3 py-1 text-left text-base transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80",
              error && "border-destructive focus-visible:ring-destructive/30",
              showClear && "pr-9",
              className,
            )}
          >
            <CalendarBlankIcon className="size-4 shrink-0 text-muted-foreground" />
            <span className={cn("truncate", !selected && "text-muted-foreground")}>
              {selected
                ? `${format(selected, "d MMM yyyy", { locale: dfLocale })} · ${time || DEFAULT_TIME}`
                : (placeholder ?? t("dateTimePlaceholder"))}
            </span>
          </PopoverTrigger>

          <PopoverContent align="start" className="w-auto gap-0 p-0">
            <Calendar
              mode="single"
              selected={selected}
              defaultMonth={defaultMonth}
              locale={dfLocale}
              captionLayout="dropdown"
              startMonth={startMonth}
              endMonth={endMonth}
              disabled={[
                ...(minDate ? [{ before: minDate }] : []),
                ...(maxDate ? [{ after:  maxDate }] : []),
              ]}
              autoFocus
              // Picking a day keeps the time already chosen — the popover stays open so the
              // hour can be adjusted straight after, which is the whole point of pairing them.
              onSelect={(d) => { if (d) onChange(joinValue(toValue(d), time)) }}
            />

            {/* Separated by a rule rather than a nested card: it is one popover, not two
                stacked surfaces (see the shadow/elevation rule — a popover already carries
                the only elevation this needs). */}
            <div className="border-t p-3">
              <Label htmlFor={`${fieldId}-time`} className="mb-1.5">{t("time")}</Label>
              <InputGroup>
                <InputGroupInput
                  id={`${fieldId}-time`}
                  type="time"
                  value={time || DEFAULT_TIME}
                  // The browser's own clock button would open a second picker inside this
                  // one; the addon below is the affordance.
                  className="appearance-none [&::-webkit-calendar-picker-indicator]:hidden"
                  onChange={(e) => onChange(joinValue(date || todayValue(), e.target.value))}
                />
                <InputGroupAddon>
                  <ClockIcon className="size-4 text-muted-foreground" />
                </InputGroupAddon>
              </InputGroup>
            </div>
          </PopoverContent>
        </Popover>

        {showClear && (
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
