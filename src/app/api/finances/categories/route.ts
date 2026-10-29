import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { financeCategorySchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const { searchParams } = new URL(req.url)
  const type             = searchParams.get("type") ?? undefined
  const includeArchived  = searchParams.get("includeArchived") === "true"

  const categories = await prisma.financeCategory.findMany({
    where:   { associationId, ...(type ? { type: type as "INCOME" | "EXPENSE" } : {}), ...(includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ type: "asc" }, { name: "asc" }],
    include: { _count: { select: { incomes: true, expenses: true, budgetLines: true, boutiqueProduits: true, boutiqueCommandeItems: true, materials: true } } },
  })
  return NextResponse.json(categories)
}, { area: "comptabilite", module: "finances" })

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body   = await req.json()
  const parsed = financeCategorySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  let category
  try {
    category = await prisma.financeCategory.create({
      data: { ...parsed.data, associationId },
    })
  } catch (error) {
    // Either unique constraint (associationId, key) or (associationId, type, lower(name))
    // WHERE archivedAt IS NULL — both mean "a category just like this one already exists",
    // which is exactly the duplicity the task asks to prevent at the source, not just at
    // reseed time.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "Une catégorie avec ce nom existe déjà" }, { status: 422 })
    }
    throw error
  }

  await writeActivityLog({ associationId, actorId: userId, action: "FINANCE_CATEGORY_CREATED", entity: "FinanceCategory", entityId: category.id, label: category.name })
  return NextResponse.json(category, { status: 201 })
}, { area: "comptabilite", module: "finances" })
