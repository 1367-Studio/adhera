"use client"

import { createContext, useContext, type ReactNode } from "react"
import type { SitePuckRootProps } from "@/lib/site-puck/site-puck-data"
import type { Locale } from "@/i18n/locales"
import type { SiteUiStrings } from "@/lib/site-puck/site-ui-strings"

// Root settings of the published new-builder page, provided by [slug]/layout.tsx only when the
// association's public site runs on the new builder. SitePublicChrome reads it to dress the
// standalone public pages like the homepage; null (no provider) keeps the old builder's chrome.
// locale/ui: this visitor's chosen page language and the matching chrome-string translations
// (src/lib/i18n/public-locale.ts, site-ui-strings.ts) — resolved once per request in the
// layout so every /[slug]/** page's chrome agrees, instead of each page resolving it again.

export type SitePuckChromeValue = { rootProps: SitePuckRootProps; locale: Locale; ui: SiteUiStrings }

const SitePuckChromeContext = createContext<SitePuckChromeValue | null>(null)

export function SitePuckChromeProvider(
  { value, children }: { value: SitePuckChromeValue; children: ReactNode },
) {
  return <SitePuckChromeContext.Provider value={value}>{children}</SitePuckChromeContext.Provider>
}

export function useSitePuckChrome(): SitePuckChromeValue | null {
  return useContext(SitePuckChromeContext)
}
