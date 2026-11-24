import { NextResponse } from "next/server"
import { format } from "date-fns"
import { utils, write } from "xlsx"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { canViewAllReimbursements } from "@/lib/finance/reimbursement-access"

function sanitizeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

const STATUS_LABELS: Record<string, string> = {
  DRAFT:             "Brouillon",
  PENDING_APPROVAL:  "En attente d'approbation",
  NEEDS_CORRECTION:  "À corriger",
  APPROVED:          "Approuvée",
  REJECTED:          "Refusée",
  REIMBURSED:        "Remboursée",
  CANCELLED:         "Annulée",
}

// Same visibility rule as the list — a requester with no "reimbursements" area access only
// ever exports their own requests.
export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId, userId, permissions } = ctx
  const { searchParams } = new URL(req.url)
  const canViewAll = canViewAllReimbursements(permissions)

  const where: Record<string, unknown> = { associationId }
  where.requesterId = canViewAll ? (searchParams.get("requesterId") || undefined) : userId
  const statusParam = searchParams.get("status")
  if (statusParam) where.status = statusParam
  const categoryIdParam = searchParams.get("categoryId")
  if (categoryIdParam) where.items = { some: { categoryId: categoryIdParam } }
  const dateFrom = searchParams.get("dateFrom")
  const dateTo   = searchParams.get("dateTo")
  if (dateFrom || dateTo) {
    where.createdAt = {
      ...(dateFrom ? { gte: new Date(dateFrom) } : {}),
      ...(dateTo   ? { lte: new Date(dateTo) }   : {}),
    }
  }

  const requests = await prisma.reimbursementRequest.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      requester: { select: { name: true } },
      items:     { include: { category: { select: { name: true } } } },
    },
  })

  const rows = requests.flatMap((r, i) =>
    r.items.map((item, j) => ({
      "#":          j === 0 ? i + 1 : "",
      Demandeur:    j === 0 ? sanitizeCell(r.requester.name ?? "") : "",
      Objet:        j === 0 ? sanitizeCell(r.subject) : "",
      "Date dépense": format(item.date, "dd/MM/yyyy"),
      Description:  sanitizeCell(item.description),
      Catégorie:    sanitizeCell(item.category.name),
      Montant:      Number(item.amount),
      Statut:       j === 0 ? (STATUS_LABELS[r.status] ?? r.status) : "",
      "Total demande": j === 0 ? Number(r.totalAmount) : "",
    })),
  )

  const wb = utils.book_new()
  const ws = utils.json_to_sheet(rows)
  ws["!cols"] = [
    { wch: 4 }, { wch: 22 }, { wch: 24 }, { wch: 14 }, { wch: 28 }, { wch: 20 }, { wch: 12 }, { wch: 22 }, { wch: 14 },
  ]
  utils.book_append_sheet(wb, ws, "Remboursements")

  const buf = write(wb, { type: "buffer", bookType: "xlsx" })
  return new NextResponse(buf, {
    headers: {
      "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="remboursements_${format(new Date(), "yyyy-MM-dd")}.xlsx"`,
    },
  })
}, { module: "reimbursements" })
