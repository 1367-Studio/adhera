import { prisma } from "@/lib/prisma/client"

// Only a VERIFIED domain may route traffic to the association — PENDING/FAILED still show
// the DNS instructions in Paramètres, but the host itself isn't live yet, so a bare host
// match here would let someone claim a domain that hasn't actually finished propagating
// (or that another association owns but abandoned mid-setup) and see a tenant's site.
export async function resolveAssociationSlugByHost(host: string): Promise<string | null> {
  const association = await prisma.association.findUnique({
    where:  { customDomain: host, customDomainStatus: "VERIFIED" },
    select: { slug: true },
  })
  return association?.slug ?? null
}
