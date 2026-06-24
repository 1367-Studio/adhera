"use client"

import { useState, useEffect } from "react"

export function useTip(id: string) {
  const key = `tip:${id}`
  const [dismissed, setDismissed] = useState(true) // starts true to avoid SSR flash

  useEffect(() => {
    setDismissed(localStorage.getItem(key) === "1")
  }, [key])

  function dismiss() {
    localStorage.setItem(key, "1")
    setDismissed(true)
  }

  return { dismissed, dismiss }
}

export function resetAllTips() {
  if (typeof window === "undefined") return
  Object.keys(localStorage)
    .filter(k => k.startsWith("tip:"))
    .forEach(k => localStorage.removeItem(k))
}
