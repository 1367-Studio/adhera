"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { UserIcon, CalendarBlankIcon, CoinsIcon, NewspaperIcon, PackageIcon, HandshakeIcon, ClipboardTextIcon, ShoppingBagIcon, VideoCameraIcon, EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarRail, useSidebar,
} from "@/components/ui/sidebar"
import { useModules, useBranding } from "@/lib/user-context"
import type { AssocModules } from "@/lib/modules"
import { APP_NAME } from "@/config/brand"
import { BrandLogo } from "@/components/layout/brand-logo"
import { LegalLinksMenuItem } from "@/components/layout/legal-links-menu"

function isActive(href: string, pathname: string) {
  return pathname === href || pathname.startsWith(href + "/")
}

export function PortalSidebar({ slug }: { slug: string }) {
  const pathname = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()
  const modules  = useModules()
  const branding = useBranding()

  const allNavItems: Array<{ href: string; label: string; icon: React.ElementType; moduleKey?: keyof AssocModules }> = [
    { href: `/portal/${slug}/actualites`, label: "Actualités",    icon: NewspaperIcon, moduleKey: "actualites"  },
    { href: `/portal/${slug}/evenements`, label: "Événements",    icon: CalendarBlankIcon,  moduleKey: "evenements"  },
    { href: `/portal/${slug}/materiel`,   label: "Matériel",      icon: PackageIcon,   moduleKey: "materiel"    },
    { href: `/portal/${slug}/cotisation`, label: "Ma cotisation", icon: CoinsIcon,          moduleKey: "cotisations" },
    { href: `/portal/${slug}/dons`,       label: "Mes dons",      icon: HandshakeIcon,  moduleKey: "dons"      },
    { href: `/portal/${slug}/sondages`,  label: "Sondages",      icon: ClipboardTextIcon,   moduleKey: "sondages"  },
    { href: `/portal/${slug}/boutique`,  label: "Boutique",      icon: ShoppingBagIcon,     moduleKey: "boutique"  },
    { href: `/portal/${slug}/reunions`,  label: "Réunions",      icon: VideoCameraIcon,           moduleKey: "reunions"  },
    { href: `/portal/${slug}/communications`, label: "Mes communications", icon: EnvelopeSimpleIcon },
    { href: `/portal/${slug}/profil`,    label: "Mon profil",    icon: UserIcon },
  ]

  const navItems = allNavItems.filter(item => !item.moduleKey || modules[item.moduleKey])

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              size="lg"
              render={<Link href={navItems[0]?.href ?? `/portal/${slug}/profil`} />}
              className="hover:bg-transparent hover:text-sidebar-foreground active:bg-transparent active:text-sidebar-foreground"
            >
              <BrandLogo logoUrl={branding?.logoUrl} imgClassName="size-8 rounded object-contain" />
              <div className="flex flex-col gap-0.5 leading-none min-w-0">
                <span className="font-semibold truncate">{branding?.name ?? APP_NAME}</span>
                <span className="text-xs text-muted-foreground">Mon espace</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map(item => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    render={<Link href={item.href} />}
                    isActive={isActive(item.href, pathname)}
                    tooltip={item.label}
                    onClick={() => { if (isMobile) setOpenMobile(false) }}
                  >
                    <item.icon />
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <LegalLinksMenuItem />
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
