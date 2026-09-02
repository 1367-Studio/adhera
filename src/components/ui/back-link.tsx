"use client"

import Link from "next/link"
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr"
import { Button } from "@/components/ui/button"

// Shared "back to list" affordance for detail pages/views. `iconOnly` keeps the
// compact icon-only look some headers use, but still exposes an accessible name
// instead of a plain unlabeled icon button.
//
// `onClick` lets a page with unsaved work call preventDefault() and confirm before the
// navigation happens — it stays a real <Link> either way, so middle-click, ctrl-click and
// "open in new tab" keep working, which a Button-with-router.push would have broken.
export function BackLink({
  href,
  children,
  iconOnly = false,
  onClick,
}: {
  href: string
  children: string
  iconOnly?: boolean
  onClick?: React.MouseEventHandler<HTMLAnchorElement>
}) {
  return (
    <Button
      variant="ghost"
      size={iconOnly ? "icon" : "sm"}
      // Base UI asserts the rendered element really is a <button> unless told otherwise —
      // this one is always an <a> (see the note above), so the native-button semantics it
      // would otherwise enforce don't apply.
      nativeButton={false}
      render={<Link href={href} aria-label={iconOnly ? children : undefined} onClick={onClick} />}
    >
      <ArrowLeftIcon className="size-4" />
      {iconOnly ? <span className="sr-only">{children}</span> : children}
    </Button>
  )
}
