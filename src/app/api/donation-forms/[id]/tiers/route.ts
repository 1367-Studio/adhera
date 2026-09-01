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
  ineligibleAmount: z.number().positive().max(100000).nullable().optional(),
}).refine(d => d.freeAmount || d.amount != null, {
  message: "Un montant est requis pour un palier à montant fixe", path: ["amount"],
}).refine(d => d.kind !== "RECURRING" || d.interval != null, {
  message: "Une périodicité est requise pour un palier récurrent", path: ["interval"],
}).refine(d => d.receiptMode !== "PARTIAL" || d.ineligibleAmount != null, {
  message: "Le montant non éligible est requis pour un reçu partiel", path: ["ineligibleAmount"],
}).refine(d => d.receiptMode !== "PARTIAL" || d.amount == null || d.ineligibleAmount == null || d.ineligibleAmount <= d.amount, {
  // Quand freeAmount est actif, `amount` est le montant minimum configuré (voir plus bas) —
  // même borne : le non-éligible ne peut pas dépasser ce plancher, sinon un donateur payant
  // tout juste le minimum obtiendrait un reçu à montant négatif.
  message: "Le montant non éligible ne peut pas dépasser le montant (ou le minimum) du don", path: ["ineligibleAmount"],
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
        // amount sert de montant fixe normalement, ou de montant minimum optionnel quand
        // freeAmount est actif (voir minAmountField dans l'éditeur) — jamais forcé à null.
        freeAmount: t.freeAmount, amount: t.amount,
        label: t.label, receiptMode: t.receiptMode,
        ineligibleAmount: t.receiptMode === "PARTIAL" ? t.ineligibleAmount : null,
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
