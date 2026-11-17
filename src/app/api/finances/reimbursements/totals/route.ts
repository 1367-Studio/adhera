import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { canViewAllReimbursements } from "@/lib/finance/reimbursement-access"

// Three tracking totals for the list's house-style summary line. Mirrors the list route's
// own requesterId scoping (same "Mes demandes" / "Toutes les demandes" / specific requester
// choice) so the summary numbers always match what the list below it is actually showing —
// otherwise a manager toggled to "Mes demandes" would see someone else's totals in the header.
export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId, userId, permissions } = ctx
  const { searchParams } = new URL(req.url)
  const requesterIdParam = searchParams.get("requesterId") ?? undefined
  const requesterId = canViewAllReimbursements(permissions) ? requesterIdParam : userId

  const [pending, approved, reimbursed] = await Promise.all([
    prisma.reimbursementRequest.aggregate({
      where: { associationId, requesterId, status: "PENDING_APPROVAL" },
      _count: true, _sum: { totalAmount: true },
    }),
    prisma.reimbursementRequest.aggregate({
      where: { associationId, requesterId, status: "APPROVED" },
      _count: true, _sum: { totalAmount: true },
    }),
    prisma.reimbursementRequest.aggregate({
      where: { associationId, requesterId, status: "REIMBURSED" },
      _count: true, _sum: { totalAmount: true },
    }),
  ])

  return NextResponse.json({
    pendingApproval: { count: pending._count,    amount: Number(pending._sum.totalAmount ?? 0) },
    approved:        { count: approved._count,   amount: Number(approved._sum.totalAmount ?? 0) },
    reimbursed:      { count: reimbursed._count, amount: Number(reimbursed._sum.totalAmount ?? 0) },
  })
}, { module: "reimbursements" })
