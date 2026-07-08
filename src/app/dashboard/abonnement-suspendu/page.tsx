import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import { SuspendedSubscriptionView } from "@/components/parametres/suspended-subscription-view"

export default async function AbonnementSuspenduPage() {
  const session = await auth()
  const u = session?.user as { associationId?: string | null; role?: string } | undefined
  if (!u?.associationId) redirect("/login")

  const assoc = await prisma.association.findUnique({
    where:  { id: u.associationId },
    select: { subscriptionStatus: true, suspendedAt: true },
  })

  // Authoritative guard read straight from the DB: without this, any admin could reach
  // this URL directly (typed, bookmarked) while ACTIVE/TRIAL/PAST_DUE and see a "cancel
  // definitively" button for a subscription that was never actually at risk. src/proxy.ts
  // only pushes locked-out admins *into* this page — it doesn't stop anyone else visiting it.
  if (!assoc || !["SUSPENDED", "CANCELLED"].includes(assoc.subscriptionStatus)) redirect("/dashboard")

  const canEdit = u.role === "ADMIN" || u.role === "PRESIDENT"

  return (
    <SuspendedSubscriptionView
      canEdit={canEdit}
      subscriptionStatus={assoc.subscriptionStatus as "SUSPENDED" | "CANCELLED"}
      suspendedAt={assoc.suspendedAt?.toISOString() ?? null}
    />
  )
}
