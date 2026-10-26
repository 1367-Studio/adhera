// Shared between /api/site-nav-menus' create and rename routes: the cap on how many named
// dropdown menus an association can have, and case-insensitive label comparison so two menus
// can't end up with names that only differ by case (confusing on the public site, where both
// would read as the same word).

// Same ceiling as headerLinks (site-puck-config.tsx) — a handful of dropdowns is already a lot
// of header real estate; past this an association should rename/merge rather than pile on more.
export const MAX_SITE_NAV_MENUS = 4

export function normalizedSiteNavMenuLabel(label: string): string {
  return label.trim().toLowerCase()
}
