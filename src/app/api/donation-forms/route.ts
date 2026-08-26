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
  const base = toSlug(title) || "don"
  let slug    = base
  let attempt = 0
  while (await prisma.donationForm.findFirst({ where: { associationId, slug }, select: { id: true } })) {
    slug = `${base}-${++attempt}`
  }
  return slug
}

export const GET = withAdminAuth(async (_req, ctx) => {
  if (!FINANCE.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const forms = await prisma.donationForm.findMany({
    where:   { associationId: ctx.associationId },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { dons: true, subscriptions: true } },
    },
  })

  // _sum per form isn't expressible in findMany — one groupBy covers all forms at once.
  const totals = await prisma.don.groupBy({
    by:     ["donationFormId"],
    where:  { associationId: ctx.associationId, donationFormId: { not: null }, paidAt: { not: null } },
    _sum:   { amount: true },
  })
  const totalByForm = new Map(totals.map(t => [t.donationFormId, Number(t._sum.amount ?? 0)]))

  return NextResponse.json(forms.map(f => ({
    ...f,
    totalAmount: totalByForm.get(f.id) ?? 0,
  })))
}, { module: "dons" })

export const POST = withAdminAuth(async (req, ctx) => {
  if (!FINANCE.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const body   = await req.json().catch(() => null)
  const parsed = createSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const { title } = parsed.data
  const slug = await generateFormSlug(ctx.associationId, title)

  const form = await prisma.donationForm.create({
    data: {
      associationId: ctx.associationId,
      title,
      slug,
    },
  })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "DONATION_FORM_CREATED",
    entity:        "DonationForm",
    entityId:      form.id,
    label:         form.title,
  })

  return NextResponse.json(form, { status: 201 })
}, { module: "dons" })
