"use client"

import { forwardRef } from "react"
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
  value: string
  label: string
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
}

export const SelectField = forwardRef<HTMLButtonElement, SelectFieldProps>(
  ({ label, options, value, onValueChange, placeholder, error, required, disabled }, ref) => {
    const fieldId     = label.toLowerCase().replace(/\s+/g, "-")
    const selectedLabel = options.find((o) => o.value === value)?.label

    return (
      <div className="space-y-1.5">
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
              {selectedLabel ?? (placeholder ?? "Choisir…")}
            </span>
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
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
