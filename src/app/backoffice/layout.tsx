import { redirect } from "next/navigation"
import { auth }     from "@/lib/auth/config"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { BackofficeSidebar } from "@/components/backoffice/backoffice-sidebar"
import { Header }    from "@/components/layout/header"
import { TopLoader } from "@/components/top-loader"
import { UserProvider, type SessionUser } from "@/lib/user-context"

export default async function BackofficeLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const u = session.user as SessionUser
  if (u.role !== "SUPER_ADMIN") redirect("/login")

  return (
    <UserProvider user={u}>
      <TopLoader />
      <SidebarProvider>
        <BackofficeSidebar />
        <SidebarInset>
          <Header user={session.user} showSidebar />
          <main className="flex flex-1 flex-col gap-4 p-4 pt-0 animate-in fade-in duration-200" style={{ animationFillMode: "both" }}>
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </UserProvider>
  )
}
