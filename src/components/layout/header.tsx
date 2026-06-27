"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
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
import { UserMenu } from "@/components/layout/user-menu"
import { NotificationBell } from "@/components/layout/notification-bell"
import { isManager } from "@/lib/user-context"
import { cn } from "@/lib/utils"

const routeLabels: Record<string, string> = {
  dashboard:    "Dashboard",
  membres:      "Membres",
  evenements:   "Événements",
  cotisations:  "Cotisations",
  tresorerie:   "Trésorerie",
  actualites:   "Actualités",
  messages:     "Messages",
  materiel:     "Matériel",
  site:         "Site web",
  parametres:   "Paramètres",
  portal:       "Mon espace",
  profil:       "Mon profil",
  backoffice:   "Backoffice",
  associations: "Associations",
}

interface HeaderProps {
  user: {
    name?:  string | null
    email?: string | null
    role?:  string
  }
  showSidebar?:     boolean
  logoutRedirect?:  string
  associationSlug?: string
}

function ViewSwitcher({ slug, pathname }: { slug: string; pathname: string }) {
  const inPortal = pathname.includes("/portal/")
  return (
    <div className="flex items-center rounded-full border bg-muted p-0.5 text-xs font-medium">
      <Link
        href={`/portal/${slug}/actualites`}
        className={cn(
          "rounded-full px-3 py-1 transition-colors",
          inPortal ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
        )}
      >
        Mon espace
      </Link>
      <Link
        href="/dashboard"
        className={cn(
          "rounded-full px-3 py-1 transition-colors",
          !inPortal ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
        )}
      >
        Gestion
      </Link>
    </div>
  )
}

export function Header({ user, showSidebar = false, logoutRedirect, associationSlug }: HeaderProps) {
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

      <span className="truncate text-sm font-medium sm:hidden">{currentLabel}</span>

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
                    <BreadcrumbLink href={href}>{label}</BreadcrumbLink>
                  )}
                </BreadcrumbItem>
              </span>
            )
          })}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="ml-auto flex items-center gap-2">
        {associationSlug && isManager(user.role ?? "") && (
          <ViewSwitcher slug={associationSlug} pathname={pathname} />
        )}
        <NotificationBell />
        <ThemeToggle />
        <UserMenu user={user} logoutRedirect={logoutRedirect} />
      </div>
    </header>
  )
}
