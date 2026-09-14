// Help-center module keys: the dashboard route segments, and the exact `helpModule` value
// list of the Sanity schema (studio/). "general" is the catch-all for content that is not
// tied to one screen. Client-safe (no server imports) — the help panel uses it directly.
export const HELP_MODULE_KEYS = [
  "dashboard", "membres", "adhesions", "cotisations", "dons", "evenements", "messages",
  "reunions", "sondages", "actualites", "suporte", "finances", "devis", "factures",
  "fournisseurs", "materiel", "site", "boutique", "activite", "parametres", "general",
] as const

export type HelpModuleKey = (typeof HELP_MODULE_KEYS)[number]

export function isHelpModuleKey(value: unknown): value is HelpModuleKey {
  return typeof value === "string" && (HELP_MODULE_KEYS as readonly string[]).includes(value)
}

// "/dashboard" → "dashboard", "/dashboard/membres/123" → "membres", anything else → "general".
// Looks for the "dashboard" segment rather than a fixed prefix so it works on both
// `usePathname()` output and `window.location.pathname` (which carries the "/app" basePath).
export function helpModuleFromPathname(pathname: string): HelpModuleKey {
  const segments       = pathname.split(/[?#]/)[0].split("/").filter(Boolean)
  const dashboardIndex = segments.indexOf("dashboard")
  if (dashboardIndex === -1) return "general"

  const moduleSegment = segments[dashboardIndex + 1]
  if (!moduleSegment) return "dashboard"
  return isHelpModuleKey(moduleSegment) ? moduleSegment : "general"
}
