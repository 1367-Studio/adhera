"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useTranslations } from "next-intl"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { ThemeToggle } from "@/components/layout/theme-toggle"
import { LocaleSwitcher } from "@/components/layout/locale-switcher"
import { UserMenu } from "@/components/layout/user-menu"
import { NotificationBell } from "@/components/layout/notification-bell"
import { HelpButton } from "@/components/layout/help-button"
import { UserIcon, SquaresFourIcon } from "@phosphor-icons/react/dist/ssr"
import { isManager } from "@/lib/user-context"
import { useNotifications } from "@/hooks/use-notifications"
import { cn } from "@/lib/utils"

function getRouteLabels(t: ReturnType<typeof useTranslations>): Record<string, string> {
  return {
    dashboard:    t("layout.appSidebar.dashboard"),
    membres:      t("layout.appSidebar.membres"),
    evenements:   t("layout.appSidebar.evenements"),
    cotisations:  t("layout.appSidebar.cotisations"),
    actualites:   t("layout.appSidebar.actualites"),
    messages:     t("layout.appSidebar.messages"),
    materiel:     t("layout.appSidebar.materiel"),
    site:         t("layout.appSidebar.site"),
    parametres:   t("layout.appSidebar.parametres"),
    portal:       t("layout.header.myPortal"),
    profil:       t("layout.header.myProfile"),
    backoffice:   t("layout.backofficeSidebar.backoffice"),
    associations: t("layout.appSidebar.associations"),
  }
}

interface HeaderProps {
  user: {
    name?:  string | null
    email?: string | null
    role?:  string
  }
  showSidebar?:     boolean
  showTour?:        boolean
  logoutRedirect?:  string
  associationSlug?: string
}

function ViewSwitcher({ slug, pathname }: { slug: string; pathname: string }) {
  const t = useTranslations("layout.header")
  const inPortal = pathname.includes("/portal/")
  // Bell only shows the current context's notifications (src/components/layout/notification-bell.tsx),
  // so unread items in the other one would otherwise go unnoticed until the user happens to
  // switch over — a dot here surfaces that without merging the two lists back together.
  const { data: membreNotifs = [] }  = useNotifications("MEMBRE")
  const { data: gestionNotifs = [] } = useNotifications("GESTION")
  const membreUnread  = membreNotifs.some(n => !n.read)
  const gestionUnread = gestionNotifs.some(n => !n.read)
  return (
    <div className="flex shrink-0 items-center rounded-full border bg-muted p-0.5 text-xs font-medium">
      <Link
        href={`/portal/${slug}/actualites`}
        title={t("myPortal")}
        className={cn(
          "relative flex items-center gap-1 rounded-full px-2 py-1 whitespace-nowrap transition-colors sm:px-3",
          inPortal ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
        )}
      >
        <UserIcon className="size-3.5 sm:hidden" />
        <span className="hidden sm:inline">{t("myPortal")}</span>
        {membreUnread && <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary sm:top-1 sm:right-1" />}
      </Link>
      <Link
        href="/dashboard"
        title={t("management")}
        className={cn(
          "relative flex items-center gap-1 rounded-full px-2 py-1 whitespace-nowrap transition-colors sm:px-3",
          !inPortal ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
        )}
      >
        <SquaresFourIcon className="size-3.5 sm:hidden" />
        <span className="hidden sm:inline">{t("management")}</span>
        {gestionUnread && <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-primary sm:top-1 sm:right-1" />}
      </Link>
    </div>
  )
}

export function Header({ user, showSidebar = false, showTour = false, logoutRedirect, associationSlug }: HeaderProps) {
  const t = useTranslations()
  const routeLabels = getRouteLabels(t)
  const pathname = usePathname()
  const looksLikeId = (s: string) => /^[a-z0-9]{20,}$/i.test(s) || /^[0-9a-f-]{36}$/i.test(s)
  const segments = pathname.split("/").filter(Boolean)
  const visibleSegments = segments.filter(s => !looksLikeId(s))
  const currentLabel = routeLabels[visibleSegments[visibleSegments.length - 1] ?? ""] ?? visibleSegments[visibleSegments.length - 1] ?? ""

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-sidebar px-4">
      {showSidebar && (
        <>
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
        </>
      )}

      <span className="min-w-0 flex-1 truncate text-sm font-medium sm:hidden">{currentLabel}</span>

      <Breadcrumb className="hidden sm:block">
        <BreadcrumbList>
          {segments.map((segment, i) => {
            if (looksLikeId(segment)) return null
            const isLast = i === segments.length - 1
            const label  = routeLabels[segment] ?? segment
            const href   = "/" + segments.slice(0, i + 1).join("/")

            return (
              <span key={segment} className="flex items-center gap-1.5">
                {i > 0 && <BreadcrumbSeparator />}
                <BreadcrumbItem>
                  {isLast ? (
                    <BreadcrumbPage>{label}</BreadcrumbPage>
                  ) : (
                    <BreadcrumbLink render={<Link href={href} />}>{label}</BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </span>
            )
          })}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex items-center gap-2">
        {associationSlug && isManager(user.role ?? "") && (
          <span data-tour="view-switcher" className="flex items-center">
            <ViewSwitcher slug={associationSlug} pathname={pathname} />
          </span>
        )}
        {showTour && <HelpButton />}
        <span data-tour="notifications" className="flex items-center">
          <NotificationBell />
        </span>
        <span data-tour="theme-toggle" className="flex items-center">
          <ThemeToggle />
        </span>
        <span className="flex items-center">
          <LocaleSwitcher />
        </span>
        <span data-tour="user-menu" className="flex items-center">
          <UserMenu user={user} logoutRedirect={logoutRedirect} />
        </span>
      </div>
    </header>
  )
}
