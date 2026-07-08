import { redirect } from "next/navigation"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import { getPricingInfo } from "@/lib/stripe"
import { ReactivateSubscriptionView } from "@/components/parametres/reactivate-subscription-view"

export default async function ReactiverAbonnementPage() {
  const session = await auth()
  const u = session?.user as { associationId?: string | null; role?: string } | undefined
  if (!u?.associationId) redirect("/login")

  // Authoritative guard read straight from the DB, same reasoning as
  // abonnement-suspendu/page.tsx: without it, any admin could reach this URL directly
  // while not actually CANCELLED.
  const assoc = await prisma.association.findUnique({
    where:  { id: u.associationId },
    select: { subscriptionStatus: true },
  })
  if (!assoc || assoc.subscriptionStatus !== "CANCELLED") redirect("/dashboard")
  if (u.role !== "ADMIN" && u.role !== "PRESIDENT") redirect("/dashboard/abonnement-suspendu")

  const pricing = await getPricingInfo()

  return <ReactivateSubscriptionView pricing={pricing} />
}
