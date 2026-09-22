"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { UserIcon, CalendarBlankIcon, CoinsIcon, NewspaperIcon, PackageIcon, HandshakeIcon, ClipboardTextIcon, ShoppingBagIcon, VideoCameraIcon, EnvelopeSimpleIcon, BookOpenTextIcon, IdentificationCardIcon } from "@phosphor-icons/react/dist/ssr";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent,
  SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem,
  SidebarRail, useSidebar,
} from "@/components/ui/sidebar"
import { useModules, useBranding } from "@/lib/user-context"
import { PORTAL_NAV_ORDER } from "@/lib/modules"
import { APP_NAME } from "@/config/brand"
import { BrandLogo } from "@/components/layout/brand-logo"
import { usePortalAssociationDocuments } from "@/hooks/use-association-documents"

function isActive(href: string, pathname: string) {
  return pathname === href || pathname.startsWith(href + "/")
}

/**
 * `memberCardEnabled` comes from the layout rather than from a query of its own: the member
 * card is not a module, so the modules context can't carry it, and the layout already reads
 * the association row this flag lives in. The member-facing settings endpoint is admin-only,
 * so the alternative would be a second request on every portal page.
 */
export function PortalSidebar({ slug, memberCardEnabled }: { slug: string; memberCardEnabled: boolean }) {
  const t           = useTranslations("portal.sidebar")
  // The card's own namespace: its label belongs with the rest of the feature's wording, not
  // with the sidebar's, and useTranslations resolves any namespace all the same.
  const tMemberCard = useTranslations("memberCard.portal")
  const pathname    = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()
  const modules     = useModules()
  const branding    = useBranding()

  const navMeta: Record<string, { label: string; icon: React.ElementType }> = {
    actualites:     { label: t("actualites"),        icon: NewspaperIcon },
    evenements:     { label: t("evenements"),        icon: CalendarBlankIcon },
    materiel:       { label: t("materiel"),          icon: PackageIcon },
    cotisation:     { label: t("cotisation"),        icon: CoinsIcon },
    carte:          { label: tMemberCard("sidebar"), icon: IdentificationCardIcon },
    dons:           { label: t("dons"),              icon: HandshakeIcon },
    sondages:       { label: t("sondages"),          icon: ClipboardTextIcon },
    boutique:       { label: t("boutique"),          icon: ShoppingBagIcon },
    reunions:       { label: t("reunions"),          icon: VideoCameraIcon },
    communications: { label: t("communications"),    icon: EnvelopeSimpleIcon },
    profil:         { label: t("profil"),            icon: UserIcon },
  }

  const navItems = PORTAL_NAV_ORDER
    .filter(item => !item.moduleKey || modules[item.moduleKey])
    // An association that hasn't turned the card on has nothing behind that entry: every
    // member would land on the "no card" screen, which is worse than no entry at all.
    .filter(item => item.path !== "carte" || memberCardEnabled)
    .map(item => ({ href: `/portal/${slug}/${item.path}`, ...navMeta[item.path] }))

  // Association documents are not a module: the footer entry only appears once the query has
  // succeeded with at least one document visible to members (hidden while loading or on error).
  const associationDocumentsQuery = usePortalAssociationDocuments()
  const associationDocumentsHref  = `/portal/${slug}/documents-association`
  const showAssociationDocuments  = associationDocumentsQuery.isSuccess && associationDocumentsQuery.data.length > 0

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

      {showAssociationDocuments && (
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                render={<Link href={associationDocumentsHref} />}
                isActive={isActive(associationDocumentsHref, pathname)}
                tooltip={t("associationDocuments")}
                onClick={() => { if (isMobile) setOpenMobile(false) }}
              >
                <BookOpenTextIcon />
                <span>{t("associationDocuments")}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      )}

      <SidebarRail />
    </Sidebar>
  )
}
