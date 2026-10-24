"use client"

import Link from "next/link"
import { CaretDownIcon } from "@phosphor-icons/react/dist/ssr"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { resolveSiteHref, isExternalHref } from "@/components/site/blocks/site-block-button"
import type { SiteLink } from "@/components/site/blocks/site-block-fields"

// Header dropdown for associations with several membership forms (one per country, chapter…)
// that would otherwise need one "Adhérer" button each — see site-navbar.tsx. Trigger styling
// matches the existing "Adhérer" outline button so it reads as the same kind of control; items
// reuse the Boutons block's own link resolution (internal path vs. external → new tab).
type Props = {
  label:          string
  items:          SiteLink[]
  slug:           string
  color:          string
}

export function SiteHeaderAdhesionMenu({ label, items, slug, color }: Props) {
  if (items.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition-opacity hover:opacity-80"
            style={{ color, borderColor: color }}
          />
        }
      >
        {label}
        <CaretDownIcon className="size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item, index) => {
          const href = resolveSiteHref(item.href, slug)
          return isExternalHref(href) ? (
            <DropdownMenuItem key={`${item.label}-${index}`} render={<a href={href} target="_blank" rel="noopener noreferrer" />}>
              {item.label}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem key={`${item.label}-${index}`} render={<Link href={href} />}>
              {item.label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
