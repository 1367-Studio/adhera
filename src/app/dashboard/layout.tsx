import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/config"
import { UserProvider, type SessionUser } from "@/lib/user-context"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { BrandStyleEffect } from "@/components/layout/brand-style-effect"
import { Header } from "@/components/layout/header"
import { PastDueBanner } from "@/components/layout/past-due-banner"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { TopLoader } from "@/components/top-loader"
import { prisma } from "@/lib/prisma/client"
import { parseModules, deriveModulesForPlan } from "@/lib/modules"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { isColorDark } from "@/lib/color"
import type { CSSProperties } from "react"
import { FiscalPeriodPopup } from "@/components/layout/fiscal-period-popup"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const u = session.user as SessionUser
  const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]
  const canManageFinance = FINANCE.includes(u.role)

  if (u.role === "SUPER_ADMIN") redirect("/backoffice")
  if (u.role === "MEMBRE")      redirect(u.associationSlug ? `/portal/${u.associationSlug}` : "/login")

  const sessionUser: SessionUser = {
    id:               u.id,
    name:             u.name,
    email:            u.email,
    role:             u.role ?? "MEMBRE",
    associationId:    u.associationId,
    associationSlug:  u.associationSlug,
  }

  const assocRow = u.associationId
    ? await prisma.association.findUnique({
        where:  { id: u.associationId },
        select: {
          modules: true, subscriptionStatus: true, plan: true, name: true,
          customBrandingEnabled: true, logoUrl: true, primaryColor: true, secondaryColor: true,
        },
      })
    : null

  const modules  = assocRow ? deriveModulesForPlan(assocRow.plan, parseModules(assocRow.modules)) : parseModules(null)
  const branding = assocRow ? { name: assocRow.name, ...resolveDocumentBranding(assocRow) } : null
  // Scoped to this subtree (not global CSS) so a Pro association's color never leaks
  // into the superadmin backoffice or another tenant's session sharing the same origin.
  const brandStyle: CSSProperties | undefined = branding?.primaryColor ? {
    "--primary":                    branding.primaryColor,
    "--primary-foreground":         isColorDark(branding.primaryColor) ? "#fff" : "#111827",
    "--ring":                       branding.primaryColor,
    "--sidebar-primary":            branding.primaryColor,
    "--sidebar-primary-foreground": isColorDark(branding.primaryColor) ? "#fff" : "#111827",
    // The selected nav item's highlight (data-active:bg-sidebar-accent in
    // src/components/ui/sidebar.tsx) reads --sidebar-accent, not --sidebar-primary —
    // that one isn't actually wired into the active-state class in this component.
    "--sidebar-accent":            branding.primaryColor,
    "--sidebar-accent-foreground": isColorDark(branding.primaryColor) ? "#fff" : "#111827",
    ...(branding.secondaryColor ? {
      "--secondary":            branding.secondaryColor,
      "--secondary-foreground": isColorDark(branding.secondaryColor) ? "#fff" : "#111827",
    } : {}),
  } as CSSProperties : undefined

  // Suspended/cancelled accounts only ever render the dedicated standby screen (and,
  // for cancelled ones, the reactivation checkout page reached from it) — enforced by
  // src/proxy.ts, which bounces every other /dashboard/* path back to the standby
  // screen. Skip the sidebar/header chrome entirely so clicking a nav link doesn't just
  // look like a bug that bounces you straight back to where you started.
  if (assocRow?.subscriptionStatus === "SUSPENDED" || assocRow?.subscriptionStatus === "CANCELLED") {
    return (
      <UserProvider user={sessionUser} modules={modules} branding={branding}>
        <TopLoader />
        {children}
      </UserProvider>
    )
  }

  const [popupUser, exerciceCount] = canManageFinance && u.associationId
  ? await Promise.all([
      prisma.user.findUnique({ where: { id: u.id }, select: { fiscalPeriodPopupSeenAt: true } }),
      prisma.exerciceComptable.count({ where: { associationId: u.associationId } }),
    ])
  : [null, 0]

  const showFiscalPeriodPopup = canManageFinance && modules.finances && !popupUser?.fiscalPeriodPopupSeenAt && exerciceCount === 0

  return (
    <UserProvider user={sessionUser} modules={parseModules(assocRow?.modules)} branding={branding}>
      <TopLoader />
      <BrandStyleEffect vars={brandStyle as Record<string, string> | undefined} />
      <SidebarProvider style={brandStyle}>
        <AppSidebar />
        <SidebarInset>
          <PastDueBanner />
          <Header user={session.user} showSidebar showTour associationSlug={u.associationSlug ?? undefined} />
          <FiscalPeriodPopup show={showFiscalPeriodPopup} />
          <main className="flex flex-1 flex-col gap-4 p-4 pt-0 animate-in fade-in duration-200" style={{ animationFillMode: "both" }}>
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </UserProvider>
  )
}
