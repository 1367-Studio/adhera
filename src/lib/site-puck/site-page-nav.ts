import { prisma } from "@/lib/prisma/client"
import type { HeaderLinkItem } from "@/components/site/site-header-link-style"

export type SitePageNavMenu = {
  id:    string
  label: string
  items: HeaderLinkItem[]
}

export type SitePageNavLinks = {
  // Each its own header button, like the existing headerLinks — a page with no menu
  // (SitePage.navMenuId === null) reads better as a plain button than a one-item dropdown.
  buttons: HeaderLinkItem[]
  // Named dropdown menus (SiteNavMenu) the association created, each grouping the pages it was
  // given (SitePage.navMenuId) — the association's own choice per page. A menu with no visible
  // page inside never renders.
  menus:   SitePageNavMenu[]
}

// FORM-7 custom pages flagged for the nav (SitePage.showInNav) — read fresh on every render
// (not frozen into Puck JSON) so a page's nav placement/order takes effect immediately, the
// same way events/actualités read live data. Server-only: never import from a "use client"
// file (site-puck-data.ts and friends), since it touches Prisma directly.

export async function liveSitePageNavLinks(associationId: string): Promise<SitePageNavLinks> {
  const [sitePages, siteNavMenus] = await Promise.all([
    prisma.sitePage.findMany({
      where:   { associationId, status: "PUBLISHED", showInNav: true },
      orderBy: { navPosition: "asc" },
      select:  { slug: true, title: true, navLabel: true, navMenuId: true },
    }),
    prisma.siteNavMenu.findMany({
      where:   { associationId },
      orderBy: { position: "asc" },
      select:  { id: true, label: true },
    }),
  ])

  const buttons: HeaderLinkItem[] = []
  const itemsByMenuId = new Map<string, HeaderLinkItem[]>()
  for (const sitePage of sitePages) {
    const link = { label: sitePage.navLabel?.trim() || sitePage.title, href: `/${sitePage.slug}` }
    if (sitePage.navMenuId) {
      const items = itemsByMenuId.get(sitePage.navMenuId) ?? []
      items.push(link)
      itemsByMenuId.set(sitePage.navMenuId, items)
    } else {
      buttons.push(link)
    }
  }

  const menus = siteNavMenus
    .map(siteNavMenu => ({ id: siteNavMenu.id, label: siteNavMenu.label, items: itemsByMenuId.get(siteNavMenu.id) ?? [] }))
    .filter(menu => menu.items.length > 0)

  return { buttons, menus }
}
