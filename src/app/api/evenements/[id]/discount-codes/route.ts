import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { evenementDiscountCodesSchema } from "@/lib/schemas/evenement"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { revalidatePublicSiteFor } from "@/lib/association/revalidate-site"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

class DiscountCodeInUseError extends Error {}
class DuplicateCodeError extends Error {}

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const evenement = await prisma.evenement.findFirst({ where: { id, associationId }, select: { id: true } })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })

  const discountCodes = await prisma.evenementDiscountCode.findMany({
    where:   { evenementId: id },
    orderBy: { createdAt: "asc" },
  })

  return NextResponse.json(discountCodes)
})

export const PUT = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const evenement = await prisma.evenement.findFirst({ where: { id, associationId } })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = evenementDiscountCodesSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const codes = parsed.data.map(d => d.code.trim().toUpperCase())
  if (new Set(codes).size !== codes.length) {
    return NextResponse.json({ error: "Deux codes ne peuvent pas être identiques." }, { status: 422 })
  }

  let discountCodes
  try {
    discountCodes = await prisma.$transaction(async (tx) => {
      // Upsert by id (scoped to this event) — même raisonnement que ticket-types : recréer
      // à chaque save minterait de nouveaux ids et orphelinerait Participation.discountCodeId.
      const existing    = await tx.evenementDiscountCode.findMany({ where: { evenementId: id }, select: { id: true } })
      const existingIds = new Set(existing.map(f => f.id))
      const incomingIds = new Set(parsed.data.filter(f => f.id).map(f => f.id))

      const toDelete = [...existingIds].filter(fid => !incomingIds.has(fid))
      if (toDelete.length) {
        const inUse = await tx.participation.count({ where: { discountCodeId: { in: toDelete } } })
        if (inUse > 0) throw new DiscountCodeInUseError()
        await tx.evenementDiscountCode.deleteMany({ where: { id: { in: toDelete } } })
      }

      // ticketTypeIds n'est jamais une FK (voir le commentaire du champ dans schema.prisma),
      // donc rien n'empêche un client d'envoyer un id périmé (tarif supprimée ailleurs, ou une
      // autre association) — filtré silencieusement plutôt que de rejeter toute la sauvegarde,
      // même logique de dégradation douce que le reste de cette fonctionnalité. Seules les
      // tarifs TICKET peuvent être ciblées, jamais une DONATION.
      const realTicketTypeIds = new Set(
        (await tx.evenementTicketType.findMany({ where: { evenementId: id, itemType: "TICKET" }, select: { id: true } })).map(tt => tt.id),
      )

      for (const f of parsed.data) {
        const code     = f.code.trim().toUpperCase()
        const startsAt = f.startsAt ? new Date(f.startsAt) : null
        const endsAt   = f.endsAt   ? new Date(f.endsAt)   : null
        const data = {
          code, kind: f.kind, value: f.value, startsAt, endsAt,
          maxUses: f.maxUses ?? null, active: f.active,
          ticketTypeIds: f.ticketTypeIds.filter(ttId => realTicketTypeIds.has(ttId)),
        }
        if (f.id && existingIds.has(f.id)) {
          await tx.evenementDiscountCode.update({ where: { id: f.id }, data })
        } else {
          await tx.evenementDiscountCode.create({ data: { ...data, evenementId: id } })
        }
      }

      return tx.evenementDiscountCode.findMany({ where: { evenementId: id }, orderBy: { createdAt: "asc" } })
    })
  } catch (err) {
    if (err instanceof DiscountCodeInUseError) {
      return NextResponse.json({ error: "Impossible de supprimer un code déjà utilisé par une inscription." }, { status: 422 })
    }
    if (err instanceof DuplicateCodeError || (err as { code?: string })?.code === "P2002") {
      return NextResponse.json({ error: "Ce code existe déjà pour cet événement." }, { status: 422 })
    }
    throw err
  }
  await revalidatePublicSiteFor(associationId)

  await writeActivityLog({
    associationId, actorId: userId, action: "EVENEMENT_UPDATED", entity: "Evenement", entityId: id,
    label: evenement.title, metadata: { discountCodesCount: discountCodes.length },
  })

  return NextResponse.json(discountCodes)
}, { roles: MANAGERS, module: "evenements" })
