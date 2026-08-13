"use client"

import { useEffect, useRef, useState } from "react"

function detect(ua: string) {
  const isMetaInApp = /FBAN|FBAV|Instagram/i.test(ua)
  const isIOS       = /iPhone|iPad|iPod/i.test(ua)
  const isAndroid   = /Android/i.test(ua)
  return { isMetaInApp, isIOS, isAndroid }
}

// Facebook/Instagram's in-app browser injects its own scripts into pages it opens, which
// can collide with React's DOM reconciliation and break interactive pages (same failure
// class as the Chrome auto-translate crash worked around in the root layout — see
// src/app/layout.tsx). Android lets us escape to the real browser automatically via an
// intent:// redirect, which the OS resolves outside Meta's webview; iOS has no equivalent
// escape hatch, so the caller should show a banner asking the visitor to do it manually.
export function useInAppBrowserEscape(): boolean {
  const [showBanner, setShowBanner] = useState(false)
  const redirected = useRef(false)

  useEffect(() => {
    const { isMetaInApp, isIOS, isAndroid } = detect(navigator.userAgent)
    if (!isMetaInApp) return

    if (isAndroid) {
      if (redirected.current) return
      redirected.current = true
      const target = window.location.href.replace(/^https?:\/\//, "")
      window.location.href = `intent://${target}#Intent;scheme=https;end`
      return
    }

    if (isIOS) setShowBanner(true)
  }, [])

  return showBanner
}
