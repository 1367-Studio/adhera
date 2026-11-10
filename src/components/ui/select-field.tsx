"use client"

import { forwardRef } from "react"
import { useTranslations } from "next-intl"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

interface SelectOption {
  value:     string
  label:     string
  disabled?: boolean
}

interface SelectFieldProps {
  label: string
  options: SelectOption[]
  value?: string
  onValueChange?: (value: string) => void
  placeholder?: string
  error?: string
  required?: boolean
  disabled?: boolean
  // Overrides the id/for pairing derived from `label` — needed when the same label text
  // is legitimately repeated on the page (e.g. one instance per row in a repeated list),
  // which would otherwise produce duplicate DOM ids.
  id?: string
}

export const SelectField = forwardRef<HTMLButtonElement, SelectFieldProps>(
  ({ label, options, value, onValueChange, placeholder, error, required, disabled, id }, ref) => {
    const t = useTranslations("common")
    const fieldId     = id ?? label.toLowerCase().replace(/\s+/g, "-")
    const selectedLabel = options.find((o) => o.value === value)?.label
    // Base UI's Select can't establish an initial highlighted item with zero <SelectItem>s,
    // so it silently refuses to open — clicking the trigger does nothing, with no error and
    // no visual difference from a working select (see FORM-102: the Membres "Pays" filter on
    // an association with no country on file yet). A disabled trigger would read as "this is
    // broken", not "there's nothing to pick" — so keep it clickable and open onto a single
    // disabled row explaining why, same as a real empty-results state would.
    const isEmpty = options.length === 0

    return (
      // flex+gap, not space-y: Base UI's Select renders a visually-hidden <input> after the
      // trigger, and space-y's :not(:last-child) rule would give the trigger phantom bottom
      // margin (the select then floats above the row baseline). Out-of-flow children don't
      // create flex items, so gap ignores the hidden input.
      <div className="flex flex-col gap-1.5">
        <Label
          htmlFor={fieldId}
          className={cn(error && "text-destructive")}
        >
          {label}
          {required && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}
        </Label>
        <Select value={value ?? ""} onValueChange={(val) => val !== null && onValueChange?.(val)} disabled={disabled}>
          <SelectTrigger
            ref={ref}
            id={fieldId}
            aria-invalid={!!error}
            className={cn(
              "w-full",
              error && "border-destructive focus-visible:ring-destructive/30"
            )}
          >
            <span className={cn("flex flex-1 text-left text-sm truncate", !selectedLabel && "text-muted-foreground")}>
              {selectedLabel ?? (placeholder ?? t("choosePlaceholder"))}
            </span>
          </SelectTrigger>
          <SelectContent>
            {isEmpty ? (
              // Reuse the caller's error message here when there is one — "Nenhuma opção
              // disponível" would otherwise contradict the red text already shown below the
              // field, which explains this is a failed fetch, not a genuinely empty result.
              <SelectItem value="__empty__" disabled>{error ?? t("noOptionsPlaceholder")}</SelectItem>
            ) : (
              options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} disabled={opt.disabled}>
                  {opt.label}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        {error && (
          <p className="text-xs text-destructive">{error}</p>
        )}
      </div>
    )
  }
)
SelectField.displayName = "SelectField"
