"use client"

import { forwardRef, useState } from "react"
import { EyeIcon, EyeSlashIcon, InfoIcon } from "@phosphor-icons/react/dist/ssr";
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

interface FormFieldProps extends React.ComponentProps<typeof Input> {
  label: string
  error?: string
  hint?: string
  // Same role as `hint`, but behind an info icon on the label instead of inline under the
  // input. For a hint too long to sit under a narrow field: in a w-40 column a 125-character
  // hint wraps to ~7 lines, and in an `items-end` row that one tall item drags every
  // neighbouring control down with it (see the tier rows in membership-tiers-editor).
  // Use `hint` for short text — an always-visible hint is still the more discoverable one.
  hintTooltip?: string
  labelAction?: React.ReactNode
  leadingIcon?: React.ReactNode
  noHtmlRequired?: boolean
}

const FormField = forwardRef<HTMLInputElement, FormFieldProps>(
  ({ label, error, hint, hintTooltip, labelAction, className, id, type, required, noHtmlRequired, leadingIcon, ...props }, ref) => {
    const fieldId = id ?? label.toLowerCase().replace(/\s+/g, "-")
    const isPassword = type === "password"
    const [showPassword, setShowPassword] = useState(false)

    return (
      // flex+gap, not space-y: the sr-only hint node below is position:absolute but still a
      // last child, so space-y's :not(:last-child) rule would give the input wrapper phantom
      // bottom margin (fields with hintTooltip then float above the row baseline).
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          {/* The trigger is a <button>, so it sits beside the <label> rather than inside it —
              nesting it would make every click on the icon also focus the input. */}
          <div className="flex items-center gap-1.5">
            <Label
              htmlFor={fieldId}
              className={cn(error && "text-destructive")}
            >
              {label}
              {required && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}
            </Label>
            {hintTooltip && (
              <Tooltip>
                {/* Named by the same sr-only node the input is described by, so the hint text
                    lives in exactly one place instead of being duplicated into an aria-label. */}
                <TooltipTrigger
                  className="text-muted-foreground hover:text-foreground"
                  aria-labelledby={`${fieldId}-hint`}
                >
                  <InfoIcon className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-64 whitespace-normal text-left">
                  {hintTooltip}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          {labelAction && (
            <span className="text-xs text-muted-foreground">{labelAction}</span>
          )}
        </div>

        <div className={cn((isPassword || leadingIcon) && "relative")}>
          {leadingIcon && (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground [&_svg]:size-4">
              {leadingIcon}
            </span>
          )}
          <Input
            ref={ref}
            id={fieldId}
            type={isPassword ? (showPassword ? "text" : "password") : type}
            required={noHtmlRequired ? false : required}
            aria-invalid={!!error}
            aria-describedby={
              error ? `${fieldId}-error` : (hint || hintTooltip) ? `${fieldId}-hint` : undefined
            }
            className={cn(
              leadingIcon && "pl-9",
              isPassword && "pr-9",
              error && "border-destructive focus-visible:ring-destructive/30",
              className
            )}
            {...props}
          />
          {isPassword && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              aria-label={showPassword ? "Masquer le mot de passe" : "Afficher le mot de passe"}
            >
              {showPassword
                ? <EyeSlashIcon className="size-4" />
                : <EyeIcon className="size-4" />
              }
            </button>
          )}
        </div>

        {error && (
          <p id={`${fieldId}-error`} className="text-xs text-destructive">
            {error}
          </p>
        )}
        {hint && !error && (
          <p id={`${fieldId}-hint`} className="text-xs text-muted-foreground">
            {hint}
          </p>
        )}
        {/* Occupies no layout — the visible copy is the tooltip; this is what the input's
            aria-describedby and the trigger's aria-labelledby both point at. */}
        {hintTooltip && !hint && (
          <p id={`${fieldId}-hint`} className="sr-only">
            {hintTooltip}
          </p>
        )}
      </div>
    )
  }
)
FormField.displayName = "FormField"

export { FormField }
