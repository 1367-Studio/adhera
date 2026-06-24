"use client"

import { forwardRef } from "react"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface TextareaFieldProps extends React.ComponentProps<"textarea"> {
  label: string
  error?: string
  hint?: string
  labelAction?: React.ReactNode
}

const TextareaField = forwardRef<HTMLTextAreaElement, TextareaFieldProps>(
  ({ label, error, hint, labelAction, className, id, required, ...props }, ref) => {
    const fieldId = id ?? label.toLowerCase().replace(/\s+/g, "-")

    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor={fieldId} className={cn(error && "text-destructive")}>
            {label}
            {required && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}
          </Label>
          {labelAction && (
            <span className="text-xs text-muted-foreground">{labelAction}</span>
          )}
        </div>

        <Textarea
          ref={ref}
          id={fieldId}
          required={required}
          aria-invalid={!!error}
          aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          className={cn(error && "border-destructive focus-visible:ring-destructive/30", className)}
          {...props}
        />

        {error && (
          <p id={`${fieldId}-error`} className="text-xs text-destructive">{error}</p>
        )}
        {hint && !error && (
          <p id={`${fieldId}-hint`} className="text-xs text-muted-foreground">{hint}</p>
        )}
      </div>
    )
  }
)
TextareaField.displayName = "TextareaField"

export { TextareaField }
