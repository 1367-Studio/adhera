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
import { headerPillClassName, headerPillStyle, type HeaderPillVariant } from "@/components/site/site-header-link-style"

// Header dropdown for associations with several membership forms (one per country, chapter…)
// that would otherwise need one "Adhérer" button each — see site-navbar.tsx. Trigger styling
// shares headerPillClassName with the other header controls so it's never the odd one out;
// items reuse the Boutons block's own link resolution (internal path vs. external → new tab).
type Props = {
  label:          string
  items:          SiteLink[]
  slug:           string
  color:          string
  variant?:       HeaderPillVariant
}

export function SiteHeaderAdhesionMenu({ label, items, slug, color, variant = "outline" }: Props) {
  if (items.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={`inline-flex items-center gap-1 ${headerPillClassName(variant)}`}
            style={headerPillStyle(variant, color)}
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
