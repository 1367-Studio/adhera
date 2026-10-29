import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { financeCategoryUpdateSchema } from "@/lib/schemas"
import { isValidAccountingCode } from "@/lib/finance/chart-of-accounts"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.financeCategory.findFirst({ where: { id, associationId } })
  if (!existing) return NextResponse.json({ error: "Catégorie introuvable" }, { status: 404 })

  const body   = await req.json()
  // `{ reactivate: true }` is the one other shape this route accepts, alongside the normal
  // field-edit payload — see the "Réactiver" action in categories-view.tsx. Kept as its own
  // branch rather than folding `archivedAt` into financeCategoryUpdateSchema: archiving itself
  // only ever happens as a side effect of DELETE (below), never a direct field edit.
  if (body && typeof body === "object" && body.reactivate === true) {
    try {
      const category = await prisma.financeCategory.update({ where: { id }, data: { archivedAt: null } })
      await writeActivityLog({ associationId, actorId: userId, action: "FINANCE_CATEGORY_REACTIVATED", entity: "FinanceCategory", entityId: id, label: category.name })
      return NextResponse.json(category)
    } catch (error) {
      // The name (or, for a default category whose key was freed on archive — see DELETE
      // below — the key) may have been claimed by a newer active category in the meantime.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return NextResponse.json({ error: "Une catégorie active porte déjà ce nom — renommez-la avant de réactiver celle-ci" }, { status: 422 })
      }
      throw error
    }
  }

  const parsed = financeCategoryUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  // The schema's own refine only validates accountingCode against `type` when both are in the
  // SAME request body — a PATCH that edits only accountingCode (type omitted) must still be
  // checked against this category's real, persisted type, or a code valid for the other type
  // could slip through (see category-standardization review notes).
  if (parsed.data.accountingCode && !parsed.data.type && !isValidAccountingCode(parsed.data.accountingCode, existing.type)) {
    return NextResponse.json({ error: "Compte comptable invalide pour ce type" }, { status: 422 })
  }

  let category
  try {
    category = await prisma.financeCategory.update({
      where: { id },
      data:  { ...parsed.data, accountingCode: parsed.data.accountingCode ?? undefined },
    })
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Une catégorie avec ce nom existe déjà" }, { status: 422 })
    }
    throw error
  }

  await writeActivityLog({ associationId, actorId: userId, action: "FINANCE_CATEGORY_UPDATED", entity: "FinanceCategory", entityId: id, label: category.name })
  return NextResponse.json(category)
}, { area: "comptabilite", module: "finances" })

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.financeCategory.findFirst({
    where:  { id, associationId },
    select: {
      name: true, key: true,
      _count: { select: { incomes: true, expenses: true, budgetLines: true, boutiqueProduits: true, boutiqueCommandeItems: true, materials: true } },
    },
  })
  if (!existing) return NextResponse.json({ error: "Catégorie introuvable" }, { status: 404 })

  const isUsed = Object.values(existing._count).some(count => count > 0)
  if (isUsed) {
    // Never hard-delete a category with real history — BudgetLine.category is onDelete:
    // Cascade (see schema.prisma), so deleting a used category would silently wipe its
    // forecast lines too. Archiving preserves every report's history unchanged (lines are
    // resolved lazily by categoryId, see income-statement.ts) while taking it out of the
    // picker for new transactions.
    //
    // `key` is left untouched — the uniqueness constraint on it is a partial index (WHERE
    // archivedAt IS NULL, see schema.prisma), so an archived row's key already stops blocking
    // getOrCreateDefaultCategory/ensureDefaultFinanceCategories from creating a fresh active
    // row under the same key. Nulling it here would be a one-way trip: reactivating this row
    // later would come back permanently keyless (unreachable by those same lookups, so future
    // transactions of that type would silently stop resolving to it) instead of cleanly
    // re-claiming its original key.
    const category = await prisma.financeCategory.update({
      where: { id },
      data:  { archivedAt: new Date() },
    })
    await writeActivityLog({ associationId, actorId: userId, action: "FINANCE_CATEGORY_ARCHIVED", entity: "FinanceCategory", entityId: id, label: category.name })
    return NextResponse.json(category)
  }

  await prisma.financeCategory.delete({ where: { id } })
  await writeActivityLog({ associationId, actorId: userId, action: "FINANCE_CATEGORY_DELETED", entity: "FinanceCategory", entityId: id, label: existing.name })
  return new NextResponse(null, { status: 204 })
}, { area: "comptabilite", module: "finances" })
