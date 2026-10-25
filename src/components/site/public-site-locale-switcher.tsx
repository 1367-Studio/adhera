"use client"

import { useId, useTransition } from "react"
import { useRouter } from "next/navigation"
import { GlobeIcon } from "@phosphor-icons/react/dist/ssr"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { setSiteLocale } from "@/lib/i18n/actions"
import { SUPPORTED_LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/locales"

// Public-site equivalent of src/components/layout/locale-switcher.tsx — same look (a ghost
// icon button inherits whatever text colour the surrounding section already resolved to, so
// it stays legible on any of the site's custom background colours without extra styling), but
// writes the SITE_LOCALE cookie instead of NEXT_LOCALE. `locale` is the server-resolved value
// (SitePuckMetadata.locale / src/lib/i18n/public-locale.ts), not next-intl's useLocale(): this
// component renders on pages whose own next-intl locale is deliberately unrelated (see the
// comment on SITE_LOCALE_COOKIE), so it can't read its current state from that context.
type Props = {
  locale:     Locale
  // "menu" (default): the globe dropdown above. "list": a labelled native <select> (listLabel)
  // for the header's mobile drawer — a portaled dropdown nested inside the modal drawer would be
  // one layer too many, and 25 plain rows made the drawer far taller than a phone screen.
  layout?:    "menu" | "list"
  listLabel?: string
}

// The native options list is drawn by the browser/OS, and on some platforms (Chrome on
// Windows/Linux) it takes the <select>'s own text color over a default white background — the
// drawer's inherited light text on a "primary" drawer would turn invisible there. Same light
// site tokens as the drawer's "light" background (menuContentStyle).
const NATIVE_OPTION_STYLE = { background: "var(--site-surface, #ffffff)", color: "var(--site-text, #111827)" }

export function PublicSiteLocaleSwitcher({ locale, layout = "menu", listLabel }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const selectId = useId()

  function handleSelect(next: Locale) {
    if (next === locale) return
    startTransition(async () => {
      await setSiteLocale(next)
      router.refresh()
    })
  }

  if (layout === "list") {
    return (
      <div className="flex flex-col gap-1.5">
        {listLabel && <label htmlFor={selectId} className="text-xs font-medium opacity-70">{listLabel}</label>}
        <select
          id={selectId}
          value={locale}
          onChange={(event) => handleSelect(event.target.value as Locale)}
          disabled={isPending}
          // Same own-color focus ring as headerPillClassName — the global admin-blue one is
          // invisible on many brand colors.
          className="h-10 w-full rounded-md border border-current/20 bg-transparent px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current"
        >
          {SUPPORTED_LOCALES.map((code) => (
            <option key={code} value={code} style={NATIVE_OPTION_STYLE}>
              {LOCALE_LABELS[code]}
            </option>
          ))}
        </select>
      </div>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            loading={isPending}
                      />
        }
      >
        <GlobeIcon className="size-4" />
        <span className="sr-only">{LOCALE_LABELS[locale]}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {SUPPORTED_LOCALES.map((code) => (
          <DropdownMenuItem key={code} onClick={() => handleSelect(code)} disabled={code === locale}>
            {LOCALE_LABELS[code]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
