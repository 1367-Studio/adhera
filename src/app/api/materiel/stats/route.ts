import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

const ALLOWED = ["ADMIN", "PRESIDENT", "SECRETAIRE", "TRESORIER"]

export const GET = withAdminAuth(async (_req, ctx) => {
  const { associationId } = ctx

  const loans = await prisma.materialLoan.findMany({
    where:  { material: { associationId }, status: "CONFIRME" },
    select: { materialId: true, quantity: true, feeAmount: true },
  })

  if (loans.length === 0) {
    return NextResponse.json({ totalRevenue: 0, topLoaned: [], revenueByMaterial: [] })
  }

  const materials = await prisma.material.findMany({
    where:  { id: { in: [...new Set(loans.map(l => l.materialId))] }, associationId },
    select: { id: true, name: true },
  })
  const nameOf = new Map(materials.map(m => [m.id, m.name]))

  // feeAmount is a per-unit rate — the amount actually billed for a loan is feeAmount × quantity
  // (see the facture route), so revenue must be aggregated the same way here.
  const byMaterial = new Map<string, { count: number; amount: number }>()
  for (const l of loans) {
    const entry = byMaterial.get(l.materialId) ?? { count: 0, amount: 0 }
    entry.count  += 1
    entry.amount += Number(l.feeAmount ?? 0) * l.quantity
    byMaterial.set(l.materialId, entry)
  }

  const totalRevenue = [...byMaterial.values()].reduce((s, v) => s + v.amount, 0)

  const topLoaned = [...byMaterial.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8)
    .map(([materialId, v]) => ({ name: nameOf.get(materialId) ?? "—", count: v.count }))

  const revenueByMaterial = [...byMaterial.entries()]
    .map(([materialId, v]) => ({ name: nameOf.get(materialId) ?? "—", amount: v.amount }))
    .filter(l => l.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8)

  return NextResponse.json({ totalRevenue, topLoaned, revenueByMaterial })
}, { roles: ALLOWED })
