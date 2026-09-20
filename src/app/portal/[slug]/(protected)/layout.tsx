import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/config"
import { UserProvider, type SessionUser } from "@/lib/user-context"
import { TopLoader } from "@/components/top-loader"
import { Header } from "@/components/layout/header"
import { PortalSidebar } from "@/components/portal/portal-sidebar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"
import { parseMemberCardSettings } from "@/lib/member-card/settings"
import { resolveDocumentBranding } from "@/lib/plan-limits"
import { pendingLegalDocuments } from "@/lib/legal/acceptance"
import { LegalReacceptanceGate } from "@/components/portal/legal-reacceptance-gate"

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
          logoUrl: true, memberCardSettings: true,
        },
      })
    : null
  const enabledModules = parseModules(assocRow?.modules)
  const branding = assocRow ? { name: assocRow.name, ...resolveDocumentBranding(assocRow) } : null
  // Read here rather than in the sidebar: the card is not a module, so it can't ride the
  // modules context, and this row is already being fetched. Only the flag travels — the
  // template and colours are the card's own business, server-side.
  const memberCardEnabled = parseMemberCardSettings(assocRow?.memberCardSettings).enabled

  // Documents the association requires agreement to and this member has not signed at the
  // wording in force — a brand-new one, or one rewritten since they last agreed. Nothing else
  // in the portal renders until they decide, which is the point of asking again.
  //
  // The Membre id is looked up alongside the user id because an agreement can be recorded
  // against either: the portal registration records both, while an agreement a manager
  // collected offline is attached to the Membre alone.
  const membreRow = u.associationId
    ? await prisma.membre.findFirst({
        where:  { userId: u.id, associationId: u.associationId, deletedAt: null },
        select: { id: true },
      })
    : null
  const pendingLegal = u.associationId
    ? await pendingLegalDocuments(u.associationId, { userId: u.id, membreId: membreRow?.id, email: u.email })
    : []
  if (pendingLegal.length > 0) {
    return <LegalReacceptanceGate slug={slug} documents={pendingLegal} />
  }

  return (
    <UserProvider user={sessionUser} modules={enabledModules} branding={branding}>
      <TopLoader />
      <SidebarProvider className="dashboard-canvas">
        <PortalSidebar slug={slug} memberCardEnabled={memberCardEnabled} />
        <SidebarInset>
          <Header user={session.user} showSidebar logoutRedirect={`/portal/${slug}/login`} associationSlug={slug} />
          <main className="flex min-h-0 flex-1 flex-col gap-4 p-4 pb-6 scroll-pt-4 md:p-6 md:scroll-pt-6 md:overflow-y-auto animate-in fade-in duration-200" style={{ animationFillMode: "both" }}>
            {children}
          </main>
        </SidebarInset>
      </SidebarProvider>
    </UserProvider>
  )
}
