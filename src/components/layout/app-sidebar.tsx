"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { SquaresFourIcon, UsersIcon, CalendarBlankIcon, CoinsIcon, GearIcon, NewspaperIcon, EnvelopeSimpleIcon, PackageIcon, GlobeIcon, PulseIcon, HeartIcon, ClipboardTextIcon, ShoppingBagIcon, VideoCameraIcon, MoneyIcon, BuildingsIcon, FileTextIcon, ReceiptIcon } from "@phosphor-icons/react/dist/ssr";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup,
  SidebarGroupContent, SidebarHeader, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useCurrentUser, useModules, useBranding } from "@/lib/user-context"
import type { AssocModules } from "@/lib/modules"
import { APP_NAME } from "@/config/brand"
import { BrandLogo } from "@/components/layout/brand-logo"
import { LegalLinksMenuItem } from "@/components/layout/legal-links-menu"

type UserRole = "ADMIN" | "PRESIDENT" | "TRESORIER" | "SECRETAIRE" | "MEMBRE"

interface NavItem {
  key:       string
  href:      string
  icon:      React.ElementType
  roles:     UserRole[]
  moduleKey?: keyof AssocModules
}

const MANAGERS: UserRole[] = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]
const FINANCE:  UserRole[] = ["ADMIN", "PRESIDENT", "TRESORIER"]

const navigationItems: NavItem[] = [
  { key: "dashboard",     href: "/dashboard",             icon: SquaresFourIcon, roles: MANAGERS },
  { key: "membres",       href: "/dashboard/membres",     icon: UsersIcon,            roles: MANAGERS },
  { key: "evenements",    href: "/dashboard/evenements",  icon: CalendarBlankIcon,         roles: MANAGERS,  moduleKey: "evenements"  },
  { key: "cotisations",   href: "/dashboard/cotisations", icon: CoinsIcon,            roles: MANAGERS,  moduleKey: "cotisations" },
  { key: "finances",      href: "/dashboard/finances",    icon: MoneyIcon,         roles: FINANCE,   moduleKey: "finances"    },
  { key: "devis",         href: "/dashboard/devis",       icon: FileTextIcon,      roles: FINANCE,   moduleKey: "devis"       },
  { key: "factures",      href: "/dashboard/factures",    icon: ReceiptIcon,       roles: FINANCE,   moduleKey: "factures"    },
  { key: "fournisseurs",  href: "/dashboard/fournisseurs", icon: BuildingsIcon,    roles: FINANCE,   moduleKey: "fournisseurs" },
  { key: "dons",          href: "/dashboard/dons",        icon: HeartIcon,            roles: FINANCE,   moduleKey: "dons"        },
  { key: "reunions",      href: "/dashboard/reunions",    icon: VideoCameraIcon,            roles: MANAGERS,  moduleKey: "reunions"    },
  { key: "sondages",      href: "/dashboard/sondages",    icon: ClipboardTextIcon,    roles: MANAGERS,  moduleKey: "sondages"    },
  { key: "boutique",      href: "/dashboard/boutique",    icon: ShoppingBagIcon,      roles: MANAGERS,  moduleKey: "boutique"    },
  { key: "actualites",    href: "/dashboard/actualites",  icon: NewspaperIcon,        roles: MANAGERS,  moduleKey: "actualites"  },
  { key: "messages",      href: "/dashboard/messages",    icon: EnvelopeSimpleIcon,             roles: ["ADMIN", "PRESIDENT", "SECRETAIRE"] as UserRole[], moduleKey: "messages" },
  { key: "materiel",      href: "/dashboard/materiel",    icon: PackageIcon,          roles: MANAGERS,  moduleKey: "materiel"    },
  { key: "site",          href: "/dashboard/site",        icon: GlobeIcon,            roles: ["ADMIN", "PRESIDENT"] as UserRole[], moduleKey: "site" },
  { key: "activite",      href: "/dashboard/activite",    icon: PulseIcon,         roles: MANAGERS },

]

function isActive(href: string, pathname: string): boolean {
  if (href === "/dashboard") return pathname === href
  return pathname === href || pathname.startsWith(href + "/")
}

export function AppSidebar() {
  const t         = useTranslations("layout.appSidebar")
  const { role }  = useCurrentUser()
  const modules   = useModules()
  const branding  = useBranding()
  const pathname  = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()

  const userRole = role as UserRole
  const visible  = navigationItems.filter(item => {
    if (!item.roles.includes(userRole)) return false
    if (item.moduleKey && !modules[item.moduleKey]) return false
    return true
  })
  // "Associations" only makes sense as a category label under the generic Adhera
  // identity — once the association shows its own logo/color, the name above it is
  // already unambiguous and the subtitle just reads as redundant.
  const isBranded = !!(branding?.logoUrl || branding?.primaryColor)

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

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {visible.map((item, idx) => (
                <SidebarMenuItem
                  key={item.href}
                  data-tour={`nav-${item.href.split("/").pop()}`}
                  style={{ animationDelay: `${30 + idx * 40}ms`, animationFillMode: "both" }}
                >
                  <SidebarMenuButton
                    render={<Link href={item.href} />}
                    isActive={isActive(item.href, pathname)}
                    tooltip={t(item.key)}
                    onClick={() => { if (isMobile) setOpenMobile(false) }}
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

      <SidebarFooter>
        <LegalLinksMenuItem />
        {["ADMIN", "PRESIDENT"].includes(userRole) && (
          <SidebarMenu>
            <SidebarMenuItem data-tour="nav-parametres">
              <SidebarMenuButton
                render={<Link href="/dashboard/parametres" />}
                isActive={isActive("/dashboard/parametres", pathname)}
                tooltip={t("parametres")}
                onClick={() => { if (isMobile) setOpenMobile(false) }}
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
