"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { SquaresFourIcon, BuildingsIcon, SignOutIcon, LifebuoyIcon, TagIcon } from "@phosphor-icons/react/dist/ssr";
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup,
  SidebarGroupContent, SidebarHeader, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar"
import { signOut } from "next-auth/react"
import { APP_NAME } from "@/config/brand"
import { BASE_PATH } from "@/lib/env"
import { LogoMark } from "@/components/layout/logo-mark"
import { useBackofficeSupportTickets } from "@/hooks/use-backoffice-support-tickets"
import { useSupportStaffTicketListener } from "@/hooks/use-support-ticket-listener"
import { useQueryClient } from "@tanstack/react-query"

const navItems = [
  { key: "overview",     href: "/backoffice",              icon: SquaresFourIcon },
  { key: "associations", href: "/backoffice/associations", icon: BuildingsIcon  },
  { key: "pricingOffers", href: "/backoffice/pricing-offers", icon: TagIcon     },
  { key: "support",      href: "/backoffice/support",      icon: LifebuoyIcon   },
]

function isActive(href: string, pathname: string) {
  if (href === "/backoffice") return pathname === href
  return pathname === href || pathname.startsWith(href + "/")
}

export function BackofficeSidebar() {
  const t         = useTranslations("layout.backofficeSidebar")
  const pathname  = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()
  const qc = useQueryClient()

  // Rendered on every backoffice page (this sidebar is part of the shared layout), so the
  // unread badge stays current without any page needing to think about it — mirrors how
  // NotificationBell (src/components/layout/notification-bell.tsx) is always mounted too.
  const { data: tickets = [] } = useBackofficeSupportTickets()
  const unreadCount = tickets.filter(ticket => ticket.unread).length
  useSupportStaffTicketListener(() => { qc.invalidateQueries({ queryKey: ["backoffice", "support-tickets"] }) })

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/backoffice" />}>
              <LogoMark />
              <div className="flex flex-col gap-0.5 leading-none">
                <span className="font-semibold">{APP_NAME}</span>
                <span className="text-xs text-muted-foreground">{t("backoffice")}</span>
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
                    tooltip={t(item.key)}
                    onClick={() => { if (isMobile) setOpenMobile(false) }}
                  >
                    <item.icon />
                    <span>{t(item.key)}</span>
                    {item.key === "support" && unreadCount > 0 && (
                      <span className="ml-auto flex size-4.5 shrink-0 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground tabular-nums">
                        {unreadCount > 9 ? "9+" : unreadCount}
                      </span>
                    )}
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton tooltip={t("signOut")} onClick={() => signOut({ callbackUrl: `${BASE_PATH}/login` })}>
              <SignOutIcon />
              <span>{t("signOut")}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
