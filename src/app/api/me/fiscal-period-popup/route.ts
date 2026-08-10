import { NextResponse } from "next/server"
import { getTranslations } from "next-intl/server"
import { prisma } from "@/lib/prisma/client"
import { pusherServer } from "@/lib/pusher-server"
import { withAdminAuth } from "@/lib/api-wrapper"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export const PATCH = withAdminAuth(async (_req, ctx) => {
  const { userId, associationId } = ctx

  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { fiscalPeriodPopupSeenAt: true },
  })
  if (user?.fiscalPeriodPopupSeenAt) return NextResponse.json({ ok: true })

  const t = await getTranslations("notifications.fiscalPeriodReminder")

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { fiscalPeriodPopupSeenAt: new Date() } }),
    prisma.notification.create({
      data: {
        userId,
        title: t("title"),
        body:  t("body"),
        link:  "/dashboard/finances/exercices",
        scope: "GESTION",
      },
    }),
  ])
  await pusherServer.trigger(`private-association-${associationId}`, "new-notification", {}).catch(() => {})

  return NextResponse.json({ ok: true })
}, { roles: FINANCE, module: "finances" })
