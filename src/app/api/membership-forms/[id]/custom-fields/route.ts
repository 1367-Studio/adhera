import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

const membershipFormFieldSchema = z.object({
  id:       z.string().optional(), // absent = nouveau champ
  type:     z.enum(["TEXT", "NUMBER"]),
  label:    z.string().trim().min(1).max(100),
  required: z.boolean().optional().default(false),
})

// PUT remplace toujours la liste entière — même convention que DonationFormField.
const membershipFormFieldsSchema = z.array(membershipFormFieldSchema).max(20)

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  if (!FINANCE.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const form = await prisma.membershipForm.findFirst({ where: { id, associationId: ctx.associationId }, select: { id: true } })
  if (!form) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const fields = await prisma.membershipFormField.findMany({ where: { formId: id }, orderBy: { order: "asc" } })
  return NextResponse.json(fields)
}, { module: "cotisations" })

export const PUT = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  if (!FINANCE.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const form = await prisma.membershipForm.findFirst({ where: { id, associationId: ctx.associationId } })
  if (!form) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = membershipFormFieldsSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const fields = await prisma.$transaction(async (tx) => {
    // Upsert by id, scoped to this form — évite d'orphaner les Membre.answers déjà répondus
    // à un id existant, même raison que DonationFormField.
    const existing    = await tx.membershipFormField.findMany({ where: { formId: id }, select: { id: true } })
    const existingIds = new Set(existing.map(f => f.id))
    const incomingIds = new Set(parsed.data.filter(f => f.id).map(f => f.id))

    const toDelete = [...existingIds].filter(fid => !incomingIds.has(fid))
    if (toDelete.length) {
      await tx.membershipFormField.deleteMany({ where: { id: { in: toDelete } } })
    }

    for (const [order, f] of parsed.data.entries()) {
      if (f.id && existingIds.has(f.id)) {
        await tx.membershipFormField.update({
          where: { id: f.id },
          data:  { type: f.type, label: f.label, required: f.required ?? false, order },
        })
      } else {
        await tx.membershipFormField.create({
          data: { formId: id, type: f.type, label: f.label, required: f.required ?? false, order },
        })
      }
    }

    return tx.membershipFormField.findMany({ where: { formId: id }, orderBy: { order: "asc" } })
  })

  return NextResponse.json(fields)
}, { module: "cotisations" })
