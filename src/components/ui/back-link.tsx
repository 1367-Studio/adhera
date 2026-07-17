"use client"

import Link from "next/link"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"

// Shared "back to list" affordance for detail pages/views. `iconOnly` keeps the
// compact icon-only look some headers use, but still exposes an accessible name
// instead of a plain unlabeled icon button.
export function BackLink({ href, children, iconOnly = false }: { href: string; children: string; iconOnly?: boolean }) {
  return (
    <Button
      variant="ghost"
      size={iconOnly ? "icon" : "sm"}
      render={<Link href={href} aria-label={iconOnly ? children : undefined} />}
    >
      <ArrowLeftIcon className="size-4" />
      {iconOnly ? <span className="sr-only">{children}</span> : children}
    </Button>
  )
}
