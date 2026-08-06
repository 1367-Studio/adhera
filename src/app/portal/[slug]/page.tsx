import { redirect } from "next/navigation"
import { prisma } from "@/lib/prisma/client"
import { parseModules, firstEnabledPortalPath } from "@/lib/modules"

export default async function PortalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const assoc = await prisma.association.findUnique({ where: { slug }, select: { modules: true } })
  const path  = firstEnabledPortalPath(parseModules(assoc?.modules))
  redirect(`/portal/${slug}/${path}`)
}
