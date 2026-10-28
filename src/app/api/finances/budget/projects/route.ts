import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { budgetProjectSchema } from "@/lib/schemas"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

// Archived projects are hidden by default (?includeArchived=1 to show them too) — kept out
// of the main list to stay calm/uncluttered while still being reachable for history.
export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx
  const includeArchived = new URL(req.url).searchParams.get("includeArchived") === "1"

  const projects = await prisma.budgetProject.findMany({
    where:   { associationId, ...(includeArchived ? {} : { archivedAt: null }) },
    orderBy: { name: "asc" },
  })
  return NextResponse.json(projects)
}, { area: "comptabilite", module: "finances" })

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body   = await req.json()
  const parsed = budgetProjectSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const project = await prisma.budgetProject.create({
    data: { associationId, name: parsed.data.name, description: parsed.data.description || null },
  })

  await writeActivityLog({ associationId, actorId: userId, action: "BUDGET_PROJECT_CREATED", entity: "BudgetProject", entityId: project.id, label: project.name })
  return NextResponse.json(project, { status: 201 })
}, { area: "comptabilite", module: "finances" })
