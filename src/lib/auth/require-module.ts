import { cache }    from "react"
import { redirect } from "next/navigation"
import { auth }     from "@/lib/auth/config"
import { prisma }   from "@/lib/prisma/client"
import { parseModules, type AssocModules } from "@/lib/modules"
import type { SessionUser } from "@/lib/user-context"

const fetchModules = cache(async (associationId: string) => {
  const row = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { modules: true },
  })
  return parseModules(row?.modules)
})

export async function requireModule(key: keyof AssocModules) {
  const session = await auth()
  const user    = session?.user as SessionUser | undefined
  if (!user?.associationId) return
  const modules = await fetchModules(user.associationId)
  if (!modules[key]) {
    if (user.role === "MEMBRE" && user.associationSlug) {
      redirect(`/portal/${user.associationSlug}/profil`)
    }
    redirect("/dashboard")
  }
}
