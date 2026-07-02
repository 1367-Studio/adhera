import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

const ADMINS = ["ADMIN", "PRESIDENT"]

const schema = z.object({
  address:            z.string().trim().max(300).optional().or(z.literal("")),
  phone:              z.string().trim().max(30).optional().or(z.literal("")),
  siren:              z.string().trim().max(14).regex(/^\d{9}(\d{5})?$|^$/, "SIREN invalide (9 ou 14 chiffres)").optional().or(z.literal("")),
  rna:                z.string().trim().max(10).regex(/^W\d{9}$|^$/, "RNA invalide (ex: W751234567)").optional().or(z.literal("")),
  canIssueTaxReceipts: z.boolean().optional(),
})

export const GET = withAdminAuth(async (req, ctx) => {
  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: {
      address:            true,
      phone:              true,
      siren:              true,
      rna:                true,
      canIssueTaxReceipts: true,
    },
  })
  if (!assoc) return NextResponse.json({ error: "Not found" }, { status: 404 })

  return NextResponse.json(assoc)
})

export const PATCH = withAdminAuth(async (req, ctx) => {
  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const { address, phone, siren, rna, canIssueTaxReceipts } = parsed.data

  // Bloqueio: não permitir ativar recibos fiscais sem SIREN ou RNA
  if (canIssueTaxReceipts) {
    const current = await prisma.association.findUnique({
      where:  { id: ctx.associationId },
      select: { siren: true, rna: true },
    })
    const effectiveSiren = siren !== undefined ? siren : current?.siren
    const effectiveRna   = rna   !== undefined ? rna   : current?.rna
    if (!effectiveSiren && !effectiveRna) {
      return NextResponse.json(
        { error: "Ajoutez un numéro SIREN ou RNA avant d'activer les reçus fiscaux." },
        { status: 422 },
      )
    }
  }

  await prisma.association.update({
    where: { id: ctx.associationId },
    data: {
      ...(address            !== undefined ? { address:            address || null }            : {}),
      ...(phone              !== undefined ? { phone:              phone || null }              : {}),
      ...(siren              !== undefined ? { siren:              siren || null }              : {}),
      ...(rna                !== undefined ? { rna:                rna || null }                : {}),
      ...(canIssueTaxReceipts !== undefined ? { canIssueTaxReceipts }                           : {}),
    },
  })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "ASSOCIATION_UPDATED",
    entity:        "Association",
    label:         "Identité juridique",
  })

  return NextResponse.json({ ok: true })
}, { roles: ADMINS })
