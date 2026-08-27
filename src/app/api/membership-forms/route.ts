import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { toSlug } from "@/lib/slug"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
})

async function generateFormSlug(associationId: string, title: string): Promise<string> {
  const base = toSlug(title) || "adhesion"
  let slug    = base
  let attempt = 0
  while (await prisma.membershipForm.findFirst({ where: { associationId, slug }, select: { id: true } })) {
    slug = `${base}-${++attempt}`
  }
  return slug
}

export const GET = withAdminAuth(async (_req, ctx) => {
  if (!FINANCE.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const forms = await prisma.membershipForm.findMany({
    where:   { associationId: ctx.associationId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { cotisations: true } },
    },
  })

  // _sum per form isn't expressible in findMany — one groupBy covers all forms at once.
  const totals = await prisma.cotisation.groupBy({
    by:    ["membershipFormId"],
    where: { associationId: ctx.associationId, membershipFormId: { not: null } },
    _sum:  { amountPaid: true },
  })
  const totalByForm = new Map(totals.map(t => [t.membershipFormId, Number(t._sum.amountPaid ?? 0)]))

  // _count.cotisations counts rows, not people — a RECURRING tier produces one Cotisation per
  // renewal (twice a year for a 6-month durationMonths tier), so it overcounts "members" for
  // any form with a recurring tier. Distinct (form, membre) pairs is what the list page's
  // "N membres" label actually means; _count.cotisations stays as-is for the delete guard
  // below, where "any row exists at all" is the right question, not "how many people".
  const distinctMembers = await prisma.cotisation.findMany({
    where:    { associationId: ctx.associationId, membershipFormId: { not: null } },
    select:   { membershipFormId: true, membreId: true },
    distinct: ["membershipFormId", "membreId"],
  })
  const memberCountByForm = new Map<string, number>()
  for (const row of distinctMembers) {
    if (!row.membershipFormId) continue
    memberCountByForm.set(row.membershipFormId, (memberCountByForm.get(row.membershipFormId) ?? 0) + 1)
  }

  return NextResponse.json(forms.map(f => ({
    ...f,
    totalAmount: totalByForm.get(f.id) ?? 0,
    memberCount: memberCountByForm.get(f.id) ?? 0,
  })))
}, { module: "cotisations" })

export const POST = withAdminAuth(async (req, ctx) => {
  if (!FINANCE.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const body   = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const { title } = parsed.data
  const slug = await generateFormSlug(ctx.associationId, title)

  const form = await prisma.membershipForm.create({
    data: {
      associationId: ctx.associationId,
      title,
      slug,
    },
  })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "MEMBERSHIP_FORM_CREATED",
    entity:        "MembershipForm",
    entityId:      form.id,
    label:         form.title,
  })

  return NextResponse.json(form, { status: 201 })
}, { module: "cotisations" })
