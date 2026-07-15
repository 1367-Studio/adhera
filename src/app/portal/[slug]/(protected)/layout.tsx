import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/config"
import { UserProvider, type SessionUser } from "@/lib/user-context"
import { TopLoader } from "@/components/top-loader"
import { Header } from "@/components/layout/header"
import { PortalSidebar } from "@/components/portal/portal-sidebar"
import { BrandStyleEffect } from "@/components/layout/brand-style-effect"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { isColorDark } from "@/lib/color"
import type { CSSProperties } from "react"

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
        select: {
          modules: true, name: true, plan: true, customBrandingEnabled: true,
          logoUrl: true, primaryColor: true, secondaryColor: true,
        },
      })
    : null
  const enabledModules = parseModules(assocRow?.modules)
  const branding = assocRow ? { name: assocRow.name, ...resolveDocumentBranding(assocRow) } : null
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

  return (
    <UserProvider user={sessionUser} modules={enabledModules} branding={branding}>
      <TopLoader />
      <BrandStyleEffect vars={brandStyle as Record<string, string> | undefined} />
      <SidebarProvider style={brandStyle}>
        <PortalSidebar slug={slug} />
        <SidebarInset>
          <Header user={session.user} showSidebar logoutRedirect={`/portal/${slug}/login`} associationSlug={slug} />
          <main className="flex flex-1 flex-col gap-4 p-4 pb-6 md:p-6 animate-in fade-in duration-200" style={{ animationFillMode: "both" }}>
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </UserProvider>
  )
}
