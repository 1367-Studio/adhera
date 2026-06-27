import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/config"
import { UserProvider, type SessionUser } from "@/lib/user-context"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { Header } from "@/components/layout/header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { TopLoader } from "@/components/top-loader"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const u = session.user as SessionUser
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
        select: { modules: true },
      })
    : null
  const enabledModules = parseModules(assocRow?.modules)

  return (
    <UserProvider user={sessionUser} modules={enabledModules}>
      <TopLoader />
      <SidebarProvider>
        <AppSidebar enabledModules={enabledModules} />
        <SidebarInset>
          <Header user={session.user} showSidebar associationSlug={u.associationSlug ?? undefined} />
          <main className="flex flex-1 flex-col gap-4 p-4 pt-0 animate-in fade-in duration-200" style={{ animationFillMode: "both" }}>
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </UserProvider>
  )
}
