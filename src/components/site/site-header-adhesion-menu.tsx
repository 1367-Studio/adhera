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
import {
  headerPillClassName, headerPillStyle, menuContentStyle, MENU_ITEM_CLASSNAME,
  type HeaderPillVariant, type MenuContentBackground,
} from "@/components/site/site-header-link-style"

// Header dropdown for associations with several membership forms (one per country, chapter…)
// that would otherwise need one "Adhérer" button each — see site-navbar.tsx. Trigger styling
// shares headerPillClassName with the other header controls so it's never the odd one out;
// items reuse the Boutons block's own link resolution (internal path vs. external → new tab).
// The panel itself (DropdownMenuContent/Item) ships styled for the admin dashboard, whose
// --popover/--accent tokens the public site never defines — menuContentStyle/MENU_ITEM_CLASSNAME
// give it real colors instead of whatever the browser falls back to.
type Props = {
  label:             string
  items:             SiteLink[]
  slug:              string
  color:             string
  variant?:          HeaderPillVariant
  // The brand's true primary — independent of `color` above, which already reflects the
  // trigger's own variant choice, because the panel's "primary" background always means the
  // real brand primary, not whatever accent the trigger happens to be using. Resolved (a real
  // hex/rgb), not "var(--site-primary)": the panel is portaled to document.body by the menu
  // library, outside the element that CSS custom property is declared on, so a var() reference
  // would resolve to nothing there — see SiteBuilderChrome's own comment on this.
  primaryColor:       string
  primaryForeground:  string
  contentBackground?: MenuContentBackground
}

export function SiteHeaderAdhesionMenu({
  label, items, slug, color, variant = "outline", primaryColor, primaryForeground, contentBackground = "light",
}: Props) {
  if (items.length === 0) return null

  const contentStyle = menuContentStyle(contentBackground, primaryColor, primaryForeground)

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
      <DropdownMenuContent align="end" style={contentStyle}>
        {items.map((item, index) => {
          const href = resolveSiteHref(item.href, slug)
          return isExternalHref(href) ? (
            <DropdownMenuItem key={`${item.label}-${index}`} className={MENU_ITEM_CLASSNAME} render={<a href={href} target="_blank" rel="noopener noreferrer" />}>
              {item.label}
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem key={`${item.label}-${index}`} className={MENU_ITEM_CLASSNAME} render={<Link href={href} />}>
              {item.label}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
