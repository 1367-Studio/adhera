"use server"

import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import { DASHBOARD_WIDGET_IDS, parseDashboardLayout } from "@/lib/dashboard-widgets"

type SessionUser = { id?: string }

export async function setDashboardLayout(order: string[]) {
  const session = await auth()
  const userId = (session?.user as SessionUser | undefined)?.id
  if (!userId) return

  await prisma.user.update({
    where: { id: userId },
    data:  { dashboardLayout: parseDashboardLayout(order) },
  })
}

export async function resetDashboardLayout() {
  return setDashboardLayout([...DASHBOARD_WIDGET_IDS])
}
