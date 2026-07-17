import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"

const DEFAULT_PAGE_SIZE = 20

export const GET = withPortalAuth(async (req, ctx) => {
  const { searchParams } = new URL(req.url)
  const page     = Math.max(1, Number(searchParams.get("page")     ?? 1)                    || 1)
  const pageSize = Math.min(100, Math.max(1, Number(searchParams.get("pageSize") ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE))

  // Scoped to the caller's own membreId — never accepts one from the client, so a member
  // can only ever see their own communications here.
  const where = { associationId: ctx.associationId, membreId: ctx.membreId! }

  const [data, total] = await Promise.all([
    prisma.emailMessage.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip:    (page - 1) * pageSize,
      take:    pageSize,
      // errorMessage is internal debugging detail (bounce/SMTP diagnostics) — not shown
      // to the member, just enough to know whether something went wrong. html excluded
      // here on purpose too — fetched on demand by emails/[emailId]/route.ts when a row
      // opens, same reasoning as the admin's membre-email-log.
      select: {
        id: true, subject: true, source: true, status: true,
        sentAt: true, deliveredAt: true, openedAt: true, clickedAt: true, bouncedAt: true, complainedAt: true, createdAt: true,
        hasAttachments: true,
      },
    }),
    prisma.emailMessage.count({ where }),
  ])

  return NextResponse.json({
    data,
    total,
    page,
    totalPages: Math.ceil(total / pageSize),
    pageSize,
  })
})
