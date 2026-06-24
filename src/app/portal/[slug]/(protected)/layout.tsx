import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/config"
import { UserProvider, type SessionUser } from "@/lib/user-context"
import { TopLoader } from "@/components/top-loader"
import { Header } from "@/components/layout/header"
import { PortalSidebar } from "@/components/portal/portal-sidebar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"

export default async function PortalLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params:   Promise<{ slug: string }>
}) {
  const { slug } = await params
  const session  = await auth()

  if (!session?.user) redirect(`/portal/${slug}/login`)

  const u = session.user as SessionUser

  // Enforce the user belongs to this association
  if (u.associationSlug !== slug) redirect(`/portal/${slug}/login`)
  if (u.role !== "MEMBRE") redirect("/dashboard")

  const sessionUser: SessionUser = {
    id:              u.id,
    name:            u.name,
    email:           u.email,
    role:            u.role ?? "MEMBRE",
    associationId:   u.associationId,
    associationSlug: slug,
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
        <PortalSidebar slug={slug} />
        <SidebarInset>
          <Header user={session.user} showSidebar logoutRedirect={`/portal/${slug}/login`} />
          <main className="flex flex-1 flex-col gap-4 p-4 pb-6 md:p-6 animate-in fade-in duration-200" style={{ animationFillMode: "both" }}>
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </UserProvider>
  )
}
