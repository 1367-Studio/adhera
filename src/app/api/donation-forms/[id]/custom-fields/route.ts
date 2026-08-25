import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

const donationFormFieldSchema = z.object({
  id:       z.string().optional(), // absent = nouveau champ
  type:     z.enum(["TEXT", "NUMBER"]),
  label:    z.string().trim().min(1).max(100),
  required: z.boolean().optional().default(false),
})

// PUT remplace toujours la liste entière — même convention qu'EvenementCustomField.
const donationFormFieldsSchema = z.array(donationFormFieldSchema).max(20)

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  if (!FINANCE.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const form = await prisma.donationForm.findFirst({ where: { id, associationId: ctx.associationId }, select: { id: true } })
  if (!form) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const fields = await prisma.donationFormField.findMany({ where: { formId: id }, orderBy: { order: "asc" } })
  return NextResponse.json(fields)
}, { module: "dons" })

export const PUT = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  if (!FINANCE.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const form = await prisma.donationForm.findFirst({ where: { id, associationId: ctx.associationId } })
  if (!form) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = donationFormFieldsSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const fields = await prisma.$transaction(async (tx) => {
    // Upsert by id, scoped to this form — see EvenementCustomField's PUT route for why
    // (avoids orphaning Don.answers keyed by ids a delete-all/recreate would discard).
    const existing    = await tx.donationFormField.findMany({ where: { formId: id }, select: { id: true } })
    const existingIds = new Set(existing.map(f => f.id))
    const incomingIds = new Set(parsed.data.filter(f => f.id).map(f => f.id))

    const toDelete = [...existingIds].filter(fid => !incomingIds.has(fid))
    if (toDelete.length) {
      await tx.donationFormField.deleteMany({ where: { id: { in: toDelete } } })
    }

    for (const [order, f] of parsed.data.entries()) {
      if (f.id && existingIds.has(f.id)) {
        await tx.donationFormField.update({
          where: { id: f.id },
          data:  { type: f.type, label: f.label, required: f.required ?? false, order },
        })
      } else {
        await tx.donationFormField.create({
          data: { formId: id, type: f.type, label: f.label, required: f.required ?? false, order },
        })
      }
    }

    return tx.donationFormField.findMany({ where: { formId: id }, orderBy: { order: "asc" } })
  })

  return NextResponse.json(fields)
}, { module: "dons" })
