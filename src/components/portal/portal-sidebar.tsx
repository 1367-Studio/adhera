"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { UserIcon, CalendarIcon, CoinsIcon, NewspaperIcon, PackageIcon } from "lucide-react"
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarRail, useSidebar,
} from "@/components/ui/sidebar"
import { useModules } from "@/lib/user-context"
import type { AssocModules } from "@/lib/modules"

function isActive(href: string, pathname: string) {
  return pathname === href || pathname.startsWith(href + "/")
}

export function PortalSidebar({ slug }: { slug: string }) {
  const pathname = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()
  const modules = useModules()

  const allNavItems: Array<{ href: string; label: string; icon: React.ElementType; moduleKey?: keyof AssocModules }> = [
    { href: `/portal/${slug}/actualites`, label: "Actualités",    icon: NewspaperIcon, moduleKey: "actualites"  },
    { href: `/portal/${slug}/evenements`, label: "Événements",    icon: CalendarIcon,  moduleKey: "evenements"  },
    { href: `/portal/${slug}/materiel`,   label: "Matériel",      icon: PackageIcon,   moduleKey: "materiel"    },
    { href: `/portal/${slug}/cotisation`, label: "Ma cotisation", icon: CoinsIcon,     moduleKey: "cotisations" },
    { href: `/portal/${slug}/profil`,     label: "Mon profil",    icon: UserIcon },
  ]

  const navItems = allNavItems.filter(item => !item.moduleKey || modules[item.moduleKey])

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href={navItems[0]?.href ?? `/portal/${slug}/profil`} />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-foreground text-background">
                <span className="text-xs font-bold">A</span>
              </div>
              <div className="flex flex-col gap-0.5 leading-none">
                <span className="font-semibold">Adhéra</span>
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

      <SidebarRail />
    </Sidebar>
  )
}
