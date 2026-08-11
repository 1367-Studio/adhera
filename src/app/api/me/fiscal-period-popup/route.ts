import { NextResponse } from "next/server"
import { getTranslations } from "next-intl/server"
import { prisma } from "@/lib/prisma/client"
import { pusherServer } from "@/lib/pusher-server"
import { withAdminAuth } from "@/lib/api-wrapper"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

// Called every time the popup itself opens (see FiscalPeriodPopup — it shows on every
// login until a fiscal period exists, by design), but this route only ever fires the
// bell notification once: fiscalPeriodPopupSeenAt gates that side effect, not whether the
// modal is shown, which is decided independently in dashboard/layout.tsx.
export const PATCH = withAdminAuth(async (_req, ctx) => {
  const { userId, associationId } = ctx

  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { fiscalPeriodPopupSeenAt: true },
  })

  // fiscalPeriodPopupSeenAt must be bumped to "now" every time the popup opens — that's
  // what dashboard/layout.tsx compares against loginAt to decide whether to show it again.
  // Returning early here on a repeat login would leave it stuck at its very first value,
  // which is then always older than the new login's loginAt — showing the popup on every
  // refresh instead of once per login. Only the bell notification is a true "once ever".
  if (user?.fiscalPeriodPopupSeenAt) {
    await prisma.user.update({ where: { id: userId }, data: { fiscalPeriodPopupSeenAt: new Date() } })
    return NextResponse.json({ ok: true })
  }

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
