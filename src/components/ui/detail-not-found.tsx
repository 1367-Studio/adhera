"use client"

import { BackLink } from "@/components/ui/back-link"

// Shared "entity not found" state for detail pages/views, so a deleted or
// mistyped id never leaves the user stranded without a way back.
export function DetailNotFound({ message, backHref, backLabel }: { message: string; backHref: string; backLabel: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <p className="text-sm text-muted-foreground">{message}</p>
      <BackLink href={backHref}>{backLabel}</BackLink>
    </div>
  )
}
