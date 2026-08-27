import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/prisma/client"

// The public site page (`/[slug]`) reads straight from Prisma with no `dynamic`/`revalidate`
// export, so Next.js caches its render as a static route and never refreshes it on its own —
// call this after any write that changes what it shows (site config, modules, events, ticket
// types) so visitors stop seeing stale content.
export function revalidatePublicSite(slug: string) {
  revalidatePath(`/${slug}`)
}

export async function revalidatePublicSiteFor(associationId: string) {
  const assoc = await prisma.association.findUnique({ where: { id: associationId }, select: { slug: true } })
  if (assoc) revalidatePublicSite(assoc.slug)
}
