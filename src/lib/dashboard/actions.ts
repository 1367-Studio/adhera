"use server"

import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import { defaultDashboardLayout, parseDashboardLayout } from "@/lib/dashboard-widgets"

type SessionUser = { id?: string }

export async function setDashboardLayout(layout: unknown) {
  const session = await auth()
  const userId = (session?.user as SessionUser | undefined)?.id
  if (!userId) return

  await prisma.user.update({
    where: { id: userId },
    data:  { dashboardLayout: parseDashboardLayout(layout) },
  })
}

export async function resetDashboardLayout() {
  return setDashboardLayout(defaultDashboardLayout())
}
