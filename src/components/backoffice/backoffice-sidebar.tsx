"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import { SquaresFourIcon, BuildingsIcon, SignOutIcon } from "@phosphor-icons/react/dist/ssr";
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

const navItems = [
  { key: "overview",     href: "/backoffice",              icon: SquaresFourIcon },
  { key: "associations", href: "/backoffice/associations", icon: BuildingsIcon        },
]

function isActive(href: string, pathname: string) {
  if (href === "/backoffice") return pathname === href
  return pathname === href || pathname.startsWith(href + "/")
}

export function BackofficeSidebar() {
  const t         = useTranslations("layout.backofficeSidebar")
  const pathname  = usePathname()
  const { isMobile, setOpenMobile } = useSidebar()

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
