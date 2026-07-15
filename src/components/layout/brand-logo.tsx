"use client"

import { useState } from "react"
import { LogoMark } from "@/components/layout/logo-mark"

interface BrandLogoProps {
  logoUrl?:          string | null
  imgClassName?:     string
  fallbackClassName?: string
}

// Falls back to the platform's own mark if the association's logo URL 404s or otherwise
// fails to load — without this, a stale/deleted R2 object leaves a permanently broken
// image icon in the sidebar/portal/check-in header instead of degrading gracefully.
export function BrandLogo({ logoUrl, imgClassName, fallbackClassName }: BrandLogoProps) {
  // Tracks *which* URL failed rather than a plain boolean, so swapping in a working logo
  // later (a new logoUrl) isn't stuck showing the fallback from a previous broken one.
  const [failedUrl, setFailedUrl] = useState<string | null>(null)

  if (!logoUrl || failedUrl === logoUrl) return <LogoMark className={fallbackClassName} />

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={logoUrl} alt="" className={imgClassName} onError={() => setFailedUrl(logoUrl)} />
  )
}
