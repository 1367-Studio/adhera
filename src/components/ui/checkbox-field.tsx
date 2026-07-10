"use client"

import { forwardRef, useId } from "react"
import { cn } from "@/lib/utils"

interface CheckboxFieldProps extends Omit<React.ComponentProps<"input">, "type"> {
  label: React.ReactNode
  description?: string
  error?: string
  hint?: string
}

const CheckboxField = forwardRef<HTMLInputElement, CheckboxFieldProps>(
  ({ label, description, error, hint, className, id, required, ...props }, ref) => {
    // Auto-derived, human-readable id for plain string labels (matches existing markup in
    // snapshots/tests); a generated id (via useId, hydration-safe) backs richer labels
    // (e.g. embedded links) instead of silently rendering without htmlFor/aria-describedby
    // when a caller forgets to pass one explicitly.
    const generatedId = useId()
    const fieldId = id ?? (typeof label === "string" ? label.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "") : generatedId)

    return (
      <div className="space-y-1">
        <div className="flex items-start gap-2.5">
          <input
            ref={ref}
            type="checkbox"
            id={fieldId}
            required={required}
            aria-invalid={!!error}
            aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
            className={cn(
              "mt-0.5 size-4 shrink-0 cursor-pointer rounded border border-input accent-primary",
              error && "border-destructive",
              className
            )}
            {...props}
          />
          <div className="space-y-0.5 leading-none">
            <label
              htmlFor={fieldId}
              className={cn("text-sm cursor-pointer", error && "text-destructive")}
            >
              {label}
              {required && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}
            </label>
            {description && (
              <p className="text-xs text-muted-foreground">{description}</p>
            )}
          </div>
        </div>

        {error && (
          <p id={`${fieldId}-error`} className="pl-6 text-xs text-destructive">{error}</p>
        )}
        {hint && !error && (
          <p id={`${fieldId}-hint`} className="pl-6 text-xs text-muted-foreground">{hint}</p>
        )}
      </div>
    )
  }
)
CheckboxField.displayName = "CheckboxField"

export { CheckboxField }
