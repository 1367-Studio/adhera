"use client"

import { createContext, useContext, type ReactNode } from "react"
import type { SitePuckRootProps } from "@/lib/site-puck/site-puck-data"

// Root settings of the published new-builder page, provided by [slug]/layout.tsx only when the
// association's public site runs on the new builder. SitePublicChrome reads it to dress the
// standalone public pages like the homepage; null (no provider) keeps the old builder's chrome.

const SitePuckChromeContext = createContext<SitePuckRootProps | null>(null)

export function SitePuckChromeProvider(
  { rootProps, children }: { rootProps: SitePuckRootProps; children: ReactNode },
) {
  return <SitePuckChromeContext.Provider value={rootProps}>{children}</SitePuckChromeContext.Provider>
}

export function useSitePuckChrome(): SitePuckRootProps | null {
  return useContext(SitePuckChromeContext)
}
