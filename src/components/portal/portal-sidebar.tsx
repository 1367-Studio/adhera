"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { UserIcon, CalendarBlankIcon, CoinsIcon, NewspaperIcon, PackageIcon, HandshakeIcon, ClipboardTextIcon, ShoppingBagIcon, VideoCameraIcon, EnvelopeSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarRail, useSidebar,
} from "@/components/ui/sidebar"
import { useModules, useBranding } from "@/lib/user-context"
import { PORTAL_NAV_ORDER } from "@/lib/modules"
import { APP_NAME } from "@/config/brand"
import { BrandLogo } from "@/components/layout/brand-logo"
import { LegalLinksMenuItem } from "@/components/layout/legal-links-menu"

function isActive(href: string, pathname: string) {
  return pathname === href || pathname.startsWith(href + "/")
}

export function PortalSidebar({ slug }: { slug: string }) {
  const t        = useTranslations("portal.sidebar")
  const pathname = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()
  const modules  = useModules()
  const branding = useBranding()

  const navMeta: Record<string, { label: string; icon: React.ElementType }> = {
    actualites:     { label: t("actualites"),     icon: NewspaperIcon },
    evenements:     { label: t("evenements"),     icon: CalendarBlankIcon },
    materiel:       { label: t("materiel"),       icon: PackageIcon },
    cotisation:     { label: t("cotisation"),     icon: CoinsIcon },
    dons:           { label: t("dons"),           icon: HandshakeIcon },
    sondages:       { label: t("sondages"),       icon: ClipboardTextIcon },
    boutique:       { label: t("boutique"),       icon: ShoppingBagIcon },
    reunions:       { label: t("reunions"),       icon: VideoCameraIcon },
    communications: { label: t("communications"), icon: EnvelopeSimpleIcon },
    profil:         { label: t("profil"),         icon: UserIcon },
  }

  const navItems = PORTAL_NAV_ORDER
    .filter(item => !item.moduleKey || modules[item.moduleKey])
    .map(item => ({ href: `/portal/${slug}/${item.path}`, ...navMeta[item.path] }))

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
              <div className="flex flex-col gap-0.5 leading-none min-w-0 ml-1">
                <span className="font-semibold truncate">{branding?.name ?? APP_NAME}</span>
                <span className="text-xs text-muted-foreground">{t("mySpace")}</span>
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
