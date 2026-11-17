// FORM-93 — small helpers shared by the item create/update/delete routes.
import { prisma } from "@/lib/prisma/client"

// ReimbursementRequest.totalAmount is denormalized (see schema.prisma) — recomputed here
// after every item add/edit/delete rather than trusted from the client.
export async function recomputeRequestTotal(requestId: string): Promise<void> {
  const items = await prisma.reimbursementItem.findMany({
    where:  { reimbursementRequestId: requestId },
    select: { amount: true },
  })
  const totalAmount = items.reduce((sum, item) => sum + Number(item.amount), 0)
  await prisma.reimbursementRequest.update({ where: { id: requestId }, data: { totalAmount } })
}

// Flags a likely duplicate — same requester, same date, same amount, on a request that's
// still live (not cancelled/rejected). Non-blocking by design (the ticket says "flag",
// not "block"): callers surface this in the response, they never reject the write over it.
export async function findDuplicateItem(
  associationId: string, requesterId: string, date: Date, amount: number, excludeItemId?: string,
): Promise<{ requestId: string; itemId: string } | null> {
  const match = await prisma.reimbursementItem.findFirst({
    where: {
      id:   excludeItemId ? { not: excludeItemId } : undefined,
      date,
      amount,
      request: {
        associationId,
        requesterId,
        status: { notIn: ["CANCELLED", "REJECTED"] },
      },
    },
    select: { id: true, reimbursementRequestId: true },
  })
  return match ? { requestId: match.reimbursementRequestId, itemId: match.id } : null
}
