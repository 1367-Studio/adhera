import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/config"
import { UserProvider, type SessionUser } from "@/lib/user-context"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { Header } from "@/components/layout/header"
import { PastDueBanner } from "@/components/layout/past-due-banner"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { TopLoader } from "@/components/top-loader"
import { prisma } from "@/lib/prisma/client"
import { parseModules, deriveModulesForPlan } from "@/lib/modules"
import { resolveDocumentBranding } from "@/lib/plan-limits"
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
          customBrandingEnabled: true, logoUrl: true,
        },
      })
    : null

  const modules  = assocRow ? deriveModulesForPlan(assocRow.plan, parseModules(assocRow.modules)) : parseModules(null)
  const branding = assocRow ? { name: assocRow.name, ...resolveDocumentBranding(assocRow) } : null

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

  // Meant to nag once per actual login (not once ever, and not once per page refresh)
  // until the association has a fiscal period configured. fiscalPeriodPopupSeenAt is
  // compared against this session's loginAt (stamped once at sign-in, see auth/config.ts's
  // jwt callback) rather than checked for mere presence: a refresh/new tab keeps the same
  // loginAt, so a popup already shown this login stays hidden, while an actual relogin
  // gets a fresh loginAt and shows it again. A session from before loginAt existed (no
  // relogin yet since this shipped) falls back to the old "ever seen" check so it doesn't
  // suddenly start reappearing on every refresh until its next real login.
  const [popupUser, exerciceCount] = canManageFinance && u.associationId
    ? await Promise.all([
        prisma.user.findUnique({ where: { id: u.id }, select: { fiscalPeriodPopupSeenAt: true } }),
        prisma.exerciceComptable.count({ where: { associationId: u.associationId } }),
      ])
    : [null, 0]

  const loginAt = (session.user as { loginAt?: number }).loginAt
  const popupSeenThisLogin = !!popupUser?.fiscalPeriodPopupSeenAt
    && (loginAt === undefined || popupUser.fiscalPeriodPopupSeenAt.getTime() >= loginAt)

  const showFiscalPeriodPopup = canManageFinance && modules.finances && exerciceCount === 0 && !popupSeenThisLogin

  return (
    <UserProvider user={sessionUser} modules={parseModules(assocRow?.modules)} branding={branding}>
      <TopLoader />
      <SidebarProvider>
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
