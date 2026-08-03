import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withPortalAuth } from "@/lib/api-wrapper"
import { nextAmountDue } from "@/lib/cotisation-status"

export const GET = withPortalAuth(async (_req, ctx) => {
  const cotisations = await prisma.cotisation.findMany({
    where:   { membreId: ctx.membreId! },
    orderBy: { year: "desc" },
    include: { installments: { orderBy: { dueDate: "asc" } } },
  })

  // Computed server-side (not left to the client) so the portal page never needs its own copy
  // of the installment-waterfall logic — it just renders whatever amount is actually payable
  // right now, which may be less than the full remaining balance when a schedule exists.
  const withAmountDue = cotisations.map(c => ({
    ...c,
    amountDue: nextAmountDue({
      amount:       Number(c.amount),
      amountPaid:   Number(c.amountPaid),
      installments: c.installments.map(i => ({ amount: Number(i.amount), dueDate: i.dueDate, order: i.order })),
    }),
  }))

  return NextResponse.json(withAmountDue)
})
