"use client"

import { useId, useTransition } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { GlobeIcon, TranslateIcon } from "@phosphor-icons/react/dist/ssr"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { setSiteLocale } from "@/lib/i18n/actions"
import { SUPPORTED_LOCALES, LOCALE_LABELS, DEFAULT_LOCALE, type Locale } from "@/i18n/locales"
import { SITE_UI_STRINGS, type SiteUiStrings } from "@/lib/site-puck/site-ui-strings"

// "translate" search param on the current page's own URL (never a cookie): association-authored
// content (articles, blocks, buttons — see translateSitePuckData/translateFields call sites)
// only translates on this explicit per-page opt-in, so it's naturally scoped to one page view —
// navigating away and back starts over in the original language until clicked again. The fixed
// UI chrome around it (this switcher's own labels, nav, footer — site-ui-strings.ts) stays on
// the always-automatic locale-based pipeline; only the TRANSLATE_PARAM below is page-scoped.
const TRANSLATE_PARAM = "translate"

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
  // Labels for the translate-this-page toggle, already in the visitor's own locale. Optional:
  // callers that render this switcher before SitePuckMetadata exists (there are none left, but
  // keeping it optional avoids a forced prop everywhere) fall back to the French defaults.
  ui?:        SiteUiStrings
}

// The native options list is drawn by the browser/OS, and on some platforms (Chrome on
// Windows/Linux) it takes the <select>'s own text color over a default white background — the
// drawer's inherited light text on a "primary" drawer would turn invisible there. Same light
// site tokens as the drawer's "light" background (menuContentStyle).
const NATIVE_OPTION_STYLE = { background: "var(--site-surface, #ffffff)", color: "var(--site-text, #111827)" }

export function PublicSiteLocaleSwitcher({ locale, layout = "menu", listLabel, ui = SITE_UI_STRINGS }: Props) {
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const selectId = useId()

  // Only a non-French locale has anything to translate — picking French never shows the toggle.
  const canTranslate = locale !== DEFAULT_LOCALE
  const isTranslated = canTranslate && searchParams.get(TRANSLATE_PARAM) === "1"

  function handleSelect(next: Locale) {
    if (next === locale) return
    startTransition(async () => {
      await setSiteLocale(next)
      router.refresh()
    })
  }

  // Toggles ?translate=1 on THIS page's own URL — never a cookie — so the opt-in stays scoped
  // to the page being viewed (see the TRANSLATE_PARAM comment above).
  function toggleTranslate() {
    const next = new URLSearchParams(searchParams.toString())
    if (isTranslated) next.delete(TRANSLATE_PARAM)
    else next.set(TRANSLATE_PARAM, "1")
    const query = next.toString()
    startTransition(() => router.push(query ? `${pathname}?${query}` : pathname))
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
        {canTranslate && (
          <button
            type="button"
            onClick={toggleTranslate}
            disabled={isPending}
            className="flex items-center gap-1.5 text-left text-xs font-medium opacity-70 hover:opacity-100"
          >
            <TranslateIcon className="size-3.5" />
            {isTranslated ? ui.showOriginalAction : ui.translatePageAction}
          </button>
        )}
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
        {canTranslate && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={toggleTranslate}>
              <TranslateIcon className="size-4" />
              {isTranslated ? ui.showOriginalAction : ui.translatePageAction}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
