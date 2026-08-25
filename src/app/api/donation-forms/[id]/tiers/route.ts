import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

const tierSchema = z.object({
  id:         z.string().optional(), // absent = nouveau palier
  order:      z.number().int().min(0),
  kind:       z.enum(["ONE_OFF", "RECURRING"]).optional().default("ONE_OFF"),
  interval:   z.enum(["MONTH", "QUARTER", "YEAR"]).nullable().optional(),
  freeAmount: z.boolean().optional().default(false),
  amount:     z.number().positive().max(100000).nullable().optional(),
  label:      z.string().trim().min(1).max(100),
  receiptMode:      z.enum(["NONE", "FULL", "PARTIAL"]).optional().default("FULL"),
  deductibleAmount: z.number().positive().max(100000).nullable().optional(),
}).refine(d => d.freeAmount || d.amount != null, {
  message: "Un montant est requis pour un palier à montant fixe", path: ["amount"],
}).refine(d => d.kind !== "RECURRING" || d.interval != null, {
  message: "Une périodicité est requise pour un palier récurrent", path: ["interval"],
}).refine(d => d.receiptMode !== "PARTIAL" || !d.freeAmount, {
  // Le montant déductible est une valeur fixe attachée au palier — n'a pas de sens pour
  // un palier à montant libre où le donateur choisit lui-même le montant versé.
  message: "Le reçu partiel n'est pas disponible pour un montant libre", path: ["receiptMode"],
}).refine(d => d.receiptMode !== "PARTIAL" || d.deductibleAmount != null, {
  message: "Le montant déductible est requis pour un reçu partiel", path: ["deductibleAmount"],
}).refine(d => d.receiptMode !== "PARTIAL" || d.amount == null || d.deductibleAmount == null || d.deductibleAmount <= d.amount, {
  message: "Le montant déductible ne peut pas dépasser le montant du don", path: ["deductibleAmount"],
})

const tiersSchema = z.array(tierSchema).max(20)

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  if (!FINANCE.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const form = await prisma.donationForm.findFirst({ where: { id, associationId: ctx.associationId }, select: { id: true } })
  if (!form) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const tiers = await prisma.donationTier.findMany({ where: { formId: id }, orderBy: { order: "asc" } })
  return NextResponse.json(tiers)
}, { module: "dons" })

export const PUT = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  if (!FINANCE.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const form = await prisma.donationForm.findFirst({ where: { id, associationId: ctx.associationId } })
  if (!form) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = tiersSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const tiers = await prisma.$transaction(async tx => {
    // Même convention d'upsert-par-id que DonationFormField/EvenementCustomField —
    // préserve les Don.tierId déjà émis plutôt que de tout recréer.
    const existing    = await tx.donationTier.findMany({ where: { formId: id }, select: { id: true } })
    const existingIds = new Set(existing.map(t => t.id))
    const incomingIds = new Set(parsed.data.filter(t => t.id).map(t => t.id))

    const toDelete = [...existingIds].filter(tid => !incomingIds.has(tid))
    if (toDelete.length) {
      await tx.donationTier.deleteMany({ where: { id: { in: toDelete } } })
    }

    for (const t of parsed.data) {
      const data = {
        order: t.order, kind: t.kind, interval: t.kind === "RECURRING" ? t.interval : null,
        freeAmount: t.freeAmount, amount: t.freeAmount ? null : t.amount,
        label: t.label, receiptMode: t.receiptMode,
        deductibleAmount: t.receiptMode === "PARTIAL" ? t.deductibleAmount : null,
      }
      if (t.id && existingIds.has(t.id)) {
        await tx.donationTier.update({ where: { id: t.id }, data })
      } else {
        await tx.donationTier.create({ data: { ...data, formId: id } })
      }
    }

    return tx.donationTier.findMany({ where: { formId: id }, orderBy: { order: "asc" } })
  })

  return NextResponse.json(tiers)
}, { module: "dons" })
