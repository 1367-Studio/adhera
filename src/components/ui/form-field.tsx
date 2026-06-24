"use client"

import { forwardRef, useState } from "react"
import { EyeIcon, EyeOffIcon } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

interface FormFieldProps extends React.ComponentProps<typeof Input> {
  label: string
  error?: string
  hint?: string
  labelAction?: React.ReactNode
  leadingIcon?: React.ReactNode
  noHtmlRequired?: boolean
}

const FormField = forwardRef<HTMLInputElement, FormFieldProps>(
  ({ label, error, hint, labelAction, className, id, type, required, noHtmlRequired, leadingIcon, ...props }, ref) => {
    const fieldId = id ?? label.toLowerCase().replace(/\s+/g, "-")
    const isPassword = type === "password"
    const [showPassword, setShowPassword] = useState(false)

    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label
            htmlFor={fieldId}
            className={cn(error && "text-destructive")}
          >
            {label}
            {required && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}
          </Label>
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
              error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined
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
                ? <EyeOffIcon className="size-4" />
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
      </div>
    )
  }
)
FormField.displayName = "FormField"

export { FormField }
