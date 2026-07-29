import type { Metadata } from "next"
import { getTranslations } from "next-intl/server"
import { auth } from "@/lib/auth/config"
import { prisma } from "@/lib/prisma/client"
import { parseDashboardLayout } from "@/lib/dashboard-widgets"
import { TableauDeBord } from "@/components/dashboard/tableau-de-bord"

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("dashboard")
  return { title: t("pageTitle") }
}

type SessionUser = { id?: string }

export default async function DashboardPage() {
  const session = await auth()
  const userId  = (session?.user as SessionUser | undefined)?.id

  const user = userId
    ? await prisma.user.findUnique({ where: { id: userId }, select: { dashboardLayout: true } })
    : null

  const initialLayout = parseDashboardLayout(user?.dashboardLayout)

  return <TableauDeBord initialLayout={initialLayout} />
}
