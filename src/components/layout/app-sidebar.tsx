"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { SquaresFourIcon, UsersIcon, CalendarBlankIcon, CoinsIcon, GearIcon, NewspaperIcon, EnvelopeSimpleIcon, PackageIcon, GlobeIcon, PulseIcon, HeartIcon, ClipboardTextIcon, ShoppingBagIcon, VideoCameraIcon, MoneyIcon, BuildingsIcon, FileTextIcon, ReceiptIcon } from "@phosphor-icons/react/dist/ssr";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup,
  SidebarGroupContent, SidebarHeader, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useCurrentUser, useModules } from "@/lib/user-context"
import type { AssocModules } from "@/lib/modules"
import { APP_NAME } from "@/config/brand"
import { LogoMark } from "@/components/layout/logo-mark"
import { LegalLinksMenuItem } from "@/components/layout/legal-links-menu"

type UserRole = "ADMIN" | "PRESIDENT" | "TRESORIER" | "SECRETAIRE" | "MEMBRE"

interface NavItem {
  name:      string
  href:      string
  icon:      React.ElementType
  roles:     UserRole[]
  moduleKey?: keyof AssocModules
}

const MANAGERS: UserRole[] = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]
const FINANCE:  UserRole[] = ["ADMIN", "PRESIDENT", "TRESORIER"]

const navigationItems: NavItem[] = [
  { name: "Tableau de bord", href: "/dashboard",             icon: SquaresFourIcon, roles: MANAGERS },
  { name: "Membres",         href: "/dashboard/membres",     icon: UsersIcon,            roles: MANAGERS },
  { name: "Événements",      href: "/dashboard/evenements",  icon: CalendarBlankIcon,         roles: MANAGERS,  moduleKey: "evenements"  },
  { name: "Cotisations",     href: "/dashboard/cotisations", icon: CoinsIcon,            roles: MANAGERS,  moduleKey: "cotisations" },
  { name: "Finances",        href: "/dashboard/finances",    icon: MoneyIcon,         roles: FINANCE,   moduleKey: "finances"    },
  { name: "Devis",           href: "/dashboard/devis",       icon: FileTextIcon,      roles: FINANCE,   moduleKey: "devis"       },
  { name: "Factures",        href: "/dashboard/factures",    icon: ReceiptIcon,       roles: FINANCE,   moduleKey: "factures"    },
  { name: "Fournisseurs",    href: "/dashboard/fournisseurs", icon: BuildingsIcon,    roles: FINANCE,   moduleKey: "fournisseurs" },
  { name: "Dons",            href: "/dashboard/dons",        icon: HeartIcon,            roles: FINANCE,   moduleKey: "dons"        },
  { name: "Réunions",        href: "/dashboard/reunions",    icon: VideoCameraIcon,            roles: MANAGERS,  moduleKey: "reunions"    },
  { name: "Sondages",        href: "/dashboard/sondages",    icon: ClipboardTextIcon,    roles: MANAGERS,  moduleKey: "sondages"    },
  { name: "Boutique",        href: "/dashboard/boutique",    icon: ShoppingBagIcon,      roles: MANAGERS,  moduleKey: "boutique"    },
  { name: "Actualités",      href: "/dashboard/actualites",  icon: NewspaperIcon,        roles: MANAGERS,  moduleKey: "actualites"  },
  { name: "Messages",        href: "/dashboard/messages",    icon: EnvelopeSimpleIcon,             roles: ["ADMIN", "PRESIDENT", "SECRETAIRE"] as UserRole[], moduleKey: "messages" },
  { name: "Matériel",        href: "/dashboard/materiel",    icon: PackageIcon,          roles: MANAGERS,  moduleKey: "materiel"    },
  { name: "Site web",        href: "/dashboard/site",        icon: GlobeIcon,            roles: ["ADMIN", "PRESIDENT"] as UserRole[], moduleKey: "site" },
  { name: "Historique",      href: "/dashboard/activite",    icon: PulseIcon,         roles: MANAGERS },

]

function isActive(href: string, pathname: string): boolean {
  if (href === "/dashboard") return pathname === href
  return pathname === href || pathname.startsWith(href + "/")
}

export function AppSidebar() {
  const { role } = useCurrentUser()
  const modules   = useModules()
  const pathname  = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()

  const userRole = role as UserRole
  const visible  = navigationItems.filter(item => {
    if (!item.roles.includes(userRole)) return false
    if (item.moduleKey && !modules[item.moduleKey]) return false
    return true
  })

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/dashboard" />}>
              <LogoMark />
              <div className="flex flex-col gap-0.5 leading-none">
                <span className="font-semibold">{APP_NAME}</span>
                <span className="text-xs text-muted-foreground">Associations</span>
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
                    tooltip={item.name}
                    onClick={() => { if (isMobile) setOpenMobile(false) }}
                  >
                    <item.icon />
                    <span>{item.name}</span>
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
                tooltip="Paramètres"
                onClick={() => { if (isMobile) setOpenMobile(false) }}
              >
                <GearIcon />
                <span>Paramètres</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
      </SidebarFooter>
    </Sidebar>
  )
}
