import { cache }        from "react"
import { redirect }     from "next/navigation"
import { NextResponse } from "next/server"
import { auth }         from "@/lib/auth/config"
import { prisma }       from "@/lib/prisma/client"
import { parseModules, type AssocModules } from "@/lib/modules"
import type { SessionUser } from "@/lib/user-context"

export const fetchModules = cache(async (associationId: string) => {
  const row = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { modules: true },
  })
  return parseModules(row?.modules)
})

/** Server Components / layouts: redirects if module is off */
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

/** API route handlers: returns 403 NextResponse if module is off, null if ok */
export async function guardModule(
  associationId: string,
  key: keyof AssocModules,
): Promise<NextResponse | null> {
  const modules = await fetchModules(associationId)
  if (!modules[key]) {
    return NextResponse.json({ error: "Module désactivé" }, { status: 403 })
  }
  return null
}
