"use client"

import { useState, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

interface CurrencyFieldProps {
  label:     string
  error?:    string
  hint?:     string
  required?: boolean
  disabled?: boolean
  value:     number
  onChange:  (value: number) => void
  onBlur?:   () => void
}

const MAX_CENTS = 9_999_999 // 99 999,99 €

interface CurrencyInputProps {
  value:     number
  onChange:  (value: number) => void
  className?: string
  disabled?: boolean
}

export function CurrencyInput({ value, onChange, className, disabled }: CurrencyInputProps) {
  const [cents, setCents] = useState(() => Math.round((value ?? 0) * 100))
  const internal          = useRef(false)
  const savedRef          = useRef(cents)
  const touchedRef        = useRef(false)

  useEffect(() => {
    if (internal.current) { internal.current = false; return }
    const ext = Math.round((value ?? 0) * 100)
    if (ext !== cents) { setCents(ext); savedRef.current = ext }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function emit(next: number) {
    internal.current = true
    setCents(next)
    onChange(next / 100)
  }

  function handleFocus() {
    savedRef.current   = cents
    touchedRef.current = false
    // Display stays unchanged — user sees the pre-filled value until they type
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.metaKey || e.ctrlKey) return
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault()
      // First keystroke clears to zero; subsequent ones shift right
      emit(touchedRef.current ? Math.floor(cents / 10) : 0)
      touchedRef.current = true
      return
    }
    if (e.key >= "0" && e.key <= "9") {
      e.preventDefault()
      // First keystroke starts accumulator fresh from this digit
      const next = touchedRef.current
        ? Math.min(cents * 10 + parseInt(e.key, 10), MAX_CENTS)
        : parseInt(e.key, 10)
      emit(next)
      touchedRef.current = true
      return
    }
    if (["Tab", "Enter", "Escape", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return
    e.preventDefault()
  }

  function handleBlur() {
    if (!touchedRef.current) setCents(savedRef.current)
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      value={fmtCents(cents)}
      disabled={disabled}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
      onChange={() => {}}
      onBlur={handleBlur}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring select-none cursor-text",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    />
  )
}

function fmtCents(cents: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

export function CurrencyField({ label, error, hint, required, disabled, value, onChange, onBlur }: CurrencyFieldProps) {
  const [cents, setCents] = useState(() => Math.round((value ?? 0) * 100))
  const internal          = useRef(false)
  const savedRef          = useRef(cents)
  const touchedRef        = useRef(false)

  useEffect(() => {
    if (internal.current) { internal.current = false; return }
    const ext = Math.round((value ?? 0) * 100)
    if (ext !== cents) { setCents(ext); savedRef.current = ext }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  function emit(next: number) {
    internal.current = true
    setCents(next)
    onChange(next / 100)
  }

  function handleFocus() {
    savedRef.current   = cents
    touchedRef.current = false
    // Display stays unchanged — user sees the pre-filled value until they type
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.metaKey || e.ctrlKey) return

    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault()
      emit(touchedRef.current ? Math.floor(cents / 10) : 0)
      touchedRef.current = true
      return
    }

    if (e.key >= "0" && e.key <= "9") {
      e.preventDefault()
      const next = touchedRef.current
        ? Math.min(cents * 10 + parseInt(e.key, 10), MAX_CENTS)
        : parseInt(e.key, 10)
      emit(next)
      touchedRef.current = true
      return
    }

    if (["Tab", "Enter", "Escape", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return
    e.preventDefault()
  }

  function handleBlur() {
    if (!touchedRef.current) setCents(savedRef.current)
    onBlur?.()
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
        {required && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}
      </label>
      <input
        type="text"
        inputMode="numeric"
        value={fmtCents(cents)}
        disabled={disabled}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        onChange={() => {/* controlled via onKeyDown */}}
        onBlur={handleBlur}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring select-none cursor-text",
          "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          error && "border-destructive",
        )}
      />
      {hint  && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
