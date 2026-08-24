"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { useQueryClient } from "@tanstack/react-query"
import { useSupportTickets } from "@/hooks/use-support-tickets"
import { useSupportTicketMessageListener } from "@/hooks/use-support-ticket-listener"
import { useBulkSendListener } from "@/hooks/use-bulk-send-listener"
import {
  SquaresFourIcon, UsersIcon, CalendarBlankIcon, CoinsIcon, GearIcon, NewspaperIcon,
  EnvelopeSimpleIcon, PackageIcon, GlobeIcon, PulseIcon, HeartIcon, ClipboardTextIcon,
  ShoppingBagIcon, VideoCameraIcon, MoneyIcon, BuildingsIcon, FileTextIcon, ReceiptIcon,
  UsersThreeIcon, ChatsCircleIcon, WrenchIcon, CaretRightIcon, LifebuoyIcon,
} from "@phosphor-icons/react/dist/ssr";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup,
  SidebarGroupContent, SidebarHeader, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubItem, SidebarMenuSubButton,
  useSidebar,
} from "@/components/ui/sidebar"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { FinanceNavTree } from "@/components/layout/finance-nav-tree"
import { cn } from "@/lib/utils"
import { useCurrentUser, useModules, useBranding } from "@/lib/user-context"
import type { AssocModules } from "@/lib/modules"
import { APP_NAME } from "@/config/brand"
import { BrandLogo } from "@/components/layout/brand-logo"
import { LegalLinksMenuItem } from "@/components/layout/legal-links-menu"

type UserRole = "ADMIN" | "PRESIDENT" | "TRESORIER" | "SECRETAIRE" | "MEMBRE"
type CategoryKey = "adherents" | "communication" | "finances" | "outils"

interface NavItem {
  key:          string
  href:         string
  icon:         React.ElementType
  roles:        UserRole[]
  moduleKey?:   keyof AssocModules
  categoryKey?: CategoryKey
}

const MANAGERS: UserRole[] = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]
const FINANCE:  UserRole[] = ["ADMIN", "PRESIDENT", "TRESORIER"]

const CATEGORIES: { key: CategoryKey; icon: React.ElementType }[] = [
  { key: "adherents",      icon: UsersThreeIcon },
  { key: "communication",  icon: ChatsCircleIcon },
  { key: "finances",       icon: MoneyIcon },
  { key: "outils",         icon: WrenchIcon },
]

// "Tableau de bord" and "Historique" have no categoryKey — Paramètres and Documents
// légaux stay exactly as they were (footer, not part of this restructure at all), which
// only left "Historique" alone in what would've been a single-item "Administration"
// category, so it stays ungrouped instead, alongside "Tableau de bord".
const navigationItems: NavItem[] = [
  { key: "dashboard",     href: "/dashboard",              icon: SquaresFourIcon,   roles: MANAGERS },

  { key: "membres",       href: "/dashboard/membres",      icon: UsersIcon,         roles: MANAGERS, categoryKey: "adherents" },
  { key: "cotisations",   href: "/dashboard/cotisations",  icon: CoinsIcon,         roles: MANAGERS, moduleKey: "cotisations", categoryKey: "adherents" },
  { key: "evenements",    href: "/dashboard/evenements",   icon: CalendarBlankIcon, roles: MANAGERS, moduleKey: "evenements",  categoryKey: "adherents" },

  { key: "messages",      href: "/dashboard/messages",     icon: EnvelopeSimpleIcon, roles: ["ADMIN", "PRESIDENT", "SECRETAIRE"] as UserRole[], moduleKey: "messages", categoryKey: "communication" },
  { key: "reunions",      href: "/dashboard/reunions",     icon: VideoCameraIcon,   roles: MANAGERS, moduleKey: "reunions",   categoryKey: "communication" },
  { key: "sondages",      href: "/dashboard/sondages",     icon: ClipboardTextIcon, roles: MANAGERS, moduleKey: "sondages",   categoryKey: "communication" },
  { key: "actualites",    href: "/dashboard/actualites",   icon: NewspaperIcon,     roles: MANAGERS, moduleKey: "actualites", categoryKey: "communication" },
  // No moduleKey — support isn't a toggleable module, every subscriber gets a channel to
  // reach the platform team. ADMIN-only per the client's own scoping of this feature.
  { key: "suporte",       href: "/dashboard/suporte",      icon: LifebuoyIcon,      roles: ["ADMIN"] as UserRole[], categoryKey: "communication" },

  { key: "finances",      href: "/dashboard/finances",     icon: MoneyIcon,      roles: FINANCE, moduleKey: "finances",     categoryKey: "finances" },
  { key: "devis",         href: "/dashboard/devis",        icon: FileTextIcon,   roles: FINANCE, moduleKey: "devis",        categoryKey: "finances" },
  { key: "factures",      href: "/dashboard/factures",     icon: ReceiptIcon,    roles: FINANCE, moduleKey: "factures",     categoryKey: "finances" },
  { key: "fournisseurs",  href: "/dashboard/fournisseurs", icon: BuildingsIcon,  roles: FINANCE, moduleKey: "fournisseurs", categoryKey: "finances" },
  { key: "dons",          href: "/dashboard/dons",         icon: HeartIcon,      roles: FINANCE, moduleKey: "dons",         categoryKey: "finances" },

  { key: "materiel",      href: "/dashboard/materiel",     icon: PackageIcon,     roles: MANAGERS, moduleKey: "materiel", categoryKey: "outils" },
  { key: "site",          href: "/dashboard/site",         icon: GlobeIcon,       roles: ["ADMIN", "PRESIDENT"] as UserRole[], moduleKey: "site", categoryKey: "outils" },
  { key: "boutique",      href: "/dashboard/boutique",     icon: ShoppingBagIcon, roles: MANAGERS, moduleKey: "boutique", categoryKey: "outils" },

  { key: "activite",      href: "/dashboard/activite",     icon: PulseIcon, roles: MANAGERS },
]

function isActive(href: string, pathname: string): boolean {
  if (href === "/dashboard") return pathname === href
  return pathname === href || pathname.startsWith(href + "/")
}

function groupByCategory(items: NavItem[]): Map<CategoryKey, NavItem[]> {
  const map = new Map<CategoryKey, NavItem[]>()
  for (const item of items) {
    if (!item.categoryKey) continue
    const list = map.get(item.categoryKey)
    if (list) list.push(item)
    else map.set(item.categoryKey, [item])
  }
  return map
}

export function AppSidebar() {
  const t         = useTranslations("layout.appSidebar")
  const { role }  = useCurrentUser()
  const modules   = useModules()
  const branding  = useBranding()
  const pathname  = usePathname()
  const { isMobile, setOpenMobile, setOpen, state } = useSidebar()
  const qc = useQueryClient()

  const userRole = role as UserRole

  // Gated to ADMIN — the API itself is ADMIN-only (see /api/support-tickets), so firing this
  // for any other role would just be a wasted request that always 403s. Mirrors the same
  // unread-badge treatment already on the backoffice sidebar (src/components/backoffice/
  // backoffice-sidebar.tsx) — an association admin deserves the same at-a-glance cue that a
  // staff reply is waiting, not just the generic notification bell.
  const { data: supportTickets = [] } = useSupportTickets({ enabled: userRole === "ADMIN" })
  const supportUnreadCount = supportTickets.filter(ticket => ticket.unread).length
  useSupportTicketMessageListener(() => { qc.invalidateQueries({ queryKey: ["support-tickets"] }) })
  useBulkSendListener()
  const visible  = navigationItems.filter(item => {
    if (!item.roles.includes(userRole)) return false
    if (item.moduleKey && !modules[item.moduleKey]) return false
    return true
  })

  // "Tableau de bord" leads the list (above the categories); "Historique" trails it
  // (below the categories, in its original position right before the footer) — not
  // grouped together, so they're split rather than rendered as one "topLevel" block.
  const leadingItems  = visible.filter(item => item.key === "dashboard")
  const trailingItems = visible.filter(item => item.key === "activite")
  const grouped       = groupByCategory(visible)

  const activeCategory = CATEGORIES.find(cat =>
    (grouped.get(cat.key) ?? []).some(item => isActive(item.href, pathname))
  )?.key ?? null

  // Lazily seeded from the active category so a hard navigation into e.g.
  // /dashboard/finances/categories arrives with "Finances" already expanded on the
  // very first paint, instead of a beat later via the effect below (which would
  // otherwise read as a visible "closed, then pops open" flash).
  const [openCategories, setOpenCategories] = useState<Set<CategoryKey>>(() => new Set(activeCategory ? [activeCategory] : []))
  // Tracks which category (if any) is currently open *because* it's the active route, as
  // opposed to the user having clicked it open themselves — only that one gets
  // auto-closed when the active route moves on, so browsing across every section in a
  // session doesn't leave every category permanently open (the whole point of grouping
  // them). Cleared the moment the user manually touches a category, so a deliberate
  // manual open/close is never overridden by this auto-behavior again.
  const autoOpenedRef = useRef<CategoryKey | null>(activeCategory)

  // Auto-expand the category containing the current page, so the active item is never
  // hidden inside a closed group.
  useEffect(() => {
    setOpenCategories(prev => {
      const next = new Set(prev)
      if (autoOpenedRef.current && autoOpenedRef.current !== activeCategory) {
        next.delete(autoOpenedRef.current)
      }
      if (activeCategory) next.add(activeCategory)
      return next
    })
    autoOpenedRef.current = activeCategory
  }, [activeCategory])

  // The onboarding tour targets nav items by [data-tour="nav-*"] selector — a target
  // living inside a still-closed category, or inside a category's icon-collapsed flyout
  // (only mounted while that dropdown is actually open), wouldn't be in the DOM for
  // driver.js to find. useTour() dispatches this before starting: forcing the sidebar out
  // of icon-collapsed mode guarantees the inline-accordion structure (not the flyout) is
  // what's rendered, and opening every category guarantees every item within it exists.
  useEffect(() => {
    function expandAll() {
      setOpen(true)
      setOpenCategories(new Set(CATEGORIES.map(cat => cat.key)))
    }
    window.addEventListener("adhera:expand-all-nav", expandAll)
    return () => window.removeEventListener("adhera:expand-all-nav", expandAll)
  }, [setOpen])

  function toggleCategory(key: CategoryKey) {
    // Once the user manually opens/closes a category, it's no longer "auto-managed" —
    // stop auto-closing it when the active route later moves elsewhere.
    if (autoOpenedRef.current === key) autoOpenedRef.current = null
    setOpenCategories(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  function closeMobile() {
    if (isMobile) setOpenMobile(false)
  }

  // On a short viewport (typical laptop height) the nav list can outgrow the space
  // between the header and footer — SidebarContent already scrolls independently
  // (flex-1/min-h-0/overflow-auto), this just adds a fade at its bottom edge while
  // there's more to scroll to, so items visually "run under" the footer instead of the
  // list just stopping abruptly. Not shown in the icon-collapsed flyout mode, where the
  // content doesn't scroll (overflow-hidden) so a "scroll for more" hint would be wrong.
  const contentRef = useRef<HTMLDivElement>(null)
  const menuRef    = useRef<HTMLUListElement>(null)
  const [showFade, setShowFade] = useState(false)

  useEffect(() => {
    const el = contentRef.current
    if (!el) return

    function updateFade() {
      if (!el) return
      const hasOverflow = el.scrollHeight > el.clientHeight + 1
      const atBottom    = el.scrollTop + el.clientHeight >= el.scrollHeight - 1
      setShowFade(hasOverflow && !atBottom)
    }

    updateFade()
    el.addEventListener("scroll", updateFade)
    window.addEventListener("resize", updateFade)

    // Watches the menu list itself (not the scroll container, whose own box never
    // changes — only its scrollHeight does) so this reacts to *any* reason the nav's
    // height changes — a category toggling, sure, but just as correctly if the item set
    // itself ever changes for some other reason — instead of only recomputing on the one
    // trigger (category open/close) that happens to be the only cause today.
    const observer = new ResizeObserver(updateFade)
    if (menuRef.current) observer.observe(menuRef.current)

    return () => {
      el.removeEventListener("scroll", updateFade)
      window.removeEventListener("resize", updateFade)
      observer.disconnect()
    }
  }, [])

  // "Associations" only makes sense as a category label under the generic Adhera
  // identity — once the association shows its own logo, the name above it is
  // already unambiguous and the subtitle just reads as redundant.
  const isBranded = !!branding?.logoUrl
  const isFlyout  = state === "collapsed" && !isMobile

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<Link href="/dashboard" />}
              className="hover:bg-transparent hover:text-sidebar-foreground active:bg-transparent active:text-sidebar-foreground"
            >
              <BrandLogo logoUrl={branding?.logoUrl} imgClassName="size-8 rounded object-contain" />
              <div className="flex flex-col gap-0.5 leading-none min-w-0 ml-1">
                <span className="font-semibold truncate">{branding?.name ?? APP_NAME}</span>
                {!isBranded && <span className="text-xs text-muted-foreground">{t("associations")}</span>}
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <div className="relative min-h-0 flex-1">
        <SidebarContent ref={contentRef} className="h-full">
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu ref={menuRef}>
                {leadingItems.map((item, idx) => (
                  <SidebarMenuItem
                    key={item.href}
                    data-tour={`nav-${item.href.split("/").pop()}`}
                    style={{ animationDelay: `${30 + idx * 40}ms`, animationFillMode: "both" }}
                  >
                    <SidebarMenuButton
                      render={<Link href={item.href} />}
                      isActive={isActive(item.href, pathname)}
                      tooltip={t(item.key)}
                      onClick={closeMobile}
                    >
                      <item.icon />
                      <span>{t(item.key)}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}

                {CATEGORIES.map((cat, idx) => {
                  const items = grouped.get(cat.key)
                  if (!items?.length) return null
                  const isOpen      = openCategories.has(cat.key)
                  const isCatActive = activeCategory === cat.key

                  return (
                    <SidebarMenuItem
                      key={cat.key}
                      data-tour={`nav-category-${cat.key}`}
                      style={{ animationDelay: `${30 + (leadingItems.length + idx) * 40}ms`, animationFillMode: "both" }}
                    >
                      {isFlyout ? (
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<SidebarMenuButton isActive={isCatActive} tooltip={t(`categories.${cat.key}`)} />}>
                            <cat.icon />
                            <span>{t(`categories.${cat.key}`)}</span>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent side="right" align="start">
                            {items.map(item =>
                              item.key === "finances" ? (
                                <FinanceNavTree key={item.href} pathname={pathname} isFlyout onNavigate={closeMobile} />
                              ) : (
                                <DropdownMenuItem key={item.href} render={<Link href={item.href} />}>
                                  <item.icon />
                                  {t(item.key)}
                                  {item.key === "suporte" && supportUnreadCount > 0 && (
                                    <span className="ml-auto flex size-4.5 shrink-0 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground tabular-nums">
                                      {supportUnreadCount > 9 ? "9+" : supportUnreadCount}
                                    </span>
                                  )}
                                </DropdownMenuItem>
                              )
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : (
                        <>
                          <SidebarMenuButton
                            isActive={isCatActive && !isOpen}
                            aria-expanded={isOpen}
                            onClick={() => toggleCategory(cat.key)}
                          >
                            <cat.icon />
                            <span>{t(`categories.${cat.key}`)}</span>
                            <span className="ml-auto flex items-center gap-1.5">
                              {cat.key === "communication" && supportUnreadCount > 0 && !isOpen && (
                                <span className="size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden />
                              )}
                              <CaretRightIcon className={cn("size-3.5 transition-transform", isOpen && "rotate-90")} />
                            </span>
                          </SidebarMenuButton>
                          {isOpen && (
                            <SidebarMenuSub>
                              {items.map(item =>
                                item.key === "finances" ? (
                                  <FinanceNavTree key={item.href} pathname={pathname} isFlyout={false} onNavigate={closeMobile} />
                                ) : (
                                  <SidebarMenuSubItem key={item.href} data-tour={`nav-${item.href.split("/").pop()}`}>
                                    <SidebarMenuSubButton
                                      render={<Link href={item.href} />}
                                      isActive={isActive(item.href, pathname)}
                                      onClick={closeMobile}
                                    >
                                      <item.icon />
                                      <span>{t(item.key)}</span>
                                      {item.key === "suporte" && supportUnreadCount > 0 && (
                                        <span className="ml-auto flex size-4.5 shrink-0 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground tabular-nums">
                                          {supportUnreadCount > 9 ? "9+" : supportUnreadCount}
                                        </span>
                                      )}
                                    </SidebarMenuSubButton>
                                  </SidebarMenuSubItem>
                                )
                              )}
                            </SidebarMenuSub>
                          )}
                        </>
                      )}
                    </SidebarMenuItem>
                  )
                })}

                {trailingItems.map((item, idx) => (
                  <SidebarMenuItem
                    key={item.href}
                    data-tour={`nav-${item.href.split("/").pop()}`}
                    style={{ animationDelay: `${30 + (leadingItems.length + CATEGORIES.length + idx) * 40}ms`, animationFillMode: "both" }}
                  >
                    <SidebarMenuButton
                      render={<Link href={item.href} />}
                      isActive={isActive(item.href, pathname)}
                      tooltip={t(item.key)}
                      onClick={closeMobile}
                    >
                      <item.icon />
                      <span>{t(item.key)}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-sidebar from-40% via-sidebar/80 to-transparent transition-opacity duration-200",
            showFade && !isFlyout ? "opacity-100" : "opacity-0",
          )}
        />
      </div>

      <SidebarFooter className="border-t border-sidebar-border pt-3">
        <LegalLinksMenuItem />
        {["ADMIN", "PRESIDENT"].includes(userRole) && (
          <SidebarMenu>
            <SidebarMenuItem data-tour="nav-parametres">
              <SidebarMenuButton
                render={<Link href="/dashboard/parametres" />}
                isActive={isActive("/dashboard/parametres", pathname)}
                tooltip={t("parametres")}
                onClick={closeMobile}
              >
                <GearIcon />
                <span>{t("parametres")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
      </SidebarFooter>
    </Sidebar>
  )
}
