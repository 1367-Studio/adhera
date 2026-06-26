"use client"

import { useState, useEffect, useRef } from "react"
import { cn } from "@/lib/utils"

interface CurrencyFieldProps {
  label:     string
  error?:    string
  hint?:     string
  required?: boolean
  value:     number
  onChange:  (value: number) => void
  onBlur?:   () => void
}

const MAX_CENTS = 9_999_999 // 99 999,99 €

interface CurrencyInputProps {
  value:     number
  onChange:  (value: number) => void
  className?: string
}

export function CurrencyInput({ value, onChange, className }: CurrencyInputProps) {
  const [cents, setCents]  = useState(() => Math.round((value ?? 0) * 100))
  const internal           = useRef(false)
  const savedRef           = useRef(cents)
  const touchedRef         = useRef(false)

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

  function handleFocus() { savedRef.current = cents; touchedRef.current = false; emit(0) }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.metaKey || e.ctrlKey) return
    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault(); touchedRef.current = true; emit(Math.floor(cents / 10)); return
    }
    if (e.key >= "0" && e.key <= "9") {
      e.preventDefault(); touchedRef.current = true
      emit(Math.min(cents * 10 + parseInt(e.key, 10), MAX_CENTS)); return
    }
    if (["Tab", "Enter", "Escape", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return
    e.preventDefault()
  }

  function handleBlur() {
    if (!touchedRef.current) emit(savedRef.current)
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      value={fmtCents(cents)}
      onFocus={handleFocus}
      onKeyDown={handleKeyDown}
      onChange={() => {}}
      onBlur={handleBlur}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring select-none cursor-text",
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

export function CurrencyField({ label, error, hint, required, value, onChange, onBlur }: CurrencyFieldProps) {
  const [cents, setCents]  = useState(() => Math.round((value ?? 0) * 100))
  const internal           = useRef(false)
  const savedRef           = useRef(cents)
  const touchedRef         = useRef(false)

  // Sync when form resets externally (e.g. dialog closes and reopens)
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
    savedRef.current  = cents
    touchedRef.current = false
    emit(0)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.metaKey || e.ctrlKey) return

    if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault()
      touchedRef.current = true
      emit(Math.floor(cents / 10))
      return
    }

    if (e.key >= "0" && e.key <= "9") {
      e.preventDefault()
      touchedRef.current = true
      emit(Math.min(cents * 10 + parseInt(e.key, 10), MAX_CENTS))
      return
    }

    if (["Tab", "Enter", "Escape", "ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return
    e.preventDefault()
  }

  function handleBlur() {
    // If user focused but didn't type anything, restore the original value
    if (!touchedRef.current) emit(savedRef.current)
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
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        onChange={() => {/* controlled via onKeyDown */}}
        onBlur={handleBlur}
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors",
          "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring select-none cursor-text",
          error && "border-destructive",
        )}
      />
      {hint  && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
