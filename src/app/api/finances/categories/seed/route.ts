import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

const DEFAULT_INCOME_CATEGORIES = [
  "Cotisations",
  "Dons",
  "Subventions",
  "Billetterie",
  "Ventes",
  "Paiements Stripe",
  "Remboursements",
  "Autres recettes",
]

const DEFAULT_EXPENSE_CATEGORIES = [
  "Assurance",
  "Matériel",
  "Location de salle",
  "Transport",
  "Communication",
  "Frais bancaires",
  "Événement",
  "Alimentation",
  "Salaires",
  "Services externes",
  "Autres dépenses",
]

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const existing = await prisma.financeCategory.findMany({
    where:  { associationId },
    select: { name: true, type: true },
  })
  const existingKeys = new Set(existing.map(c => `${c.type}|${c.name}`))

  const toCreate = [
    ...DEFAULT_INCOME_CATEGORIES.map(name => ({ name, type: "INCOME" as const, isDefault: true })),
    ...DEFAULT_EXPENSE_CATEGORIES.map(name => ({ name, type: "EXPENSE" as const, isDefault: true })),
  ].filter(c => !existingKeys.has(`${c.type}|${c.name}`))

  if (toCreate.length > 0) {
    await prisma.financeCategory.createMany({
      data: toCreate.map(c => ({ ...c, associationId })),
    })
  }

  return NextResponse.json({ created: toCreate.length, skipped: existing.length })
}, { roles: FINANCE, module: "finances" })
