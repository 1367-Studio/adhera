import { prisma } from "@/lib/prisma/client"

// Guards against a stale/foreign/wrong-type categoryId reaching a Prisma `create`/`update`
// and crashing with a raw FK-violation 500 — also stops a categoryId belonging to another
// association (or an EXPENSE category) from silently attaching to an income-producing record.
export async function assertIncomeCategory(associationId: string, categoryId: string): Promise<string | null> {
  const category = await prisma.financeCategory.findFirst({
    where:  { id: categoryId, associationId, type: "INCOME" },
    select: { id: true },
  })
  return category ? null : "Catégorie comptable invalide"
}
