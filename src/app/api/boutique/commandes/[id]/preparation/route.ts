import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { guardModule } from "@/lib/auth/require-module"
import { withAdminAuth } from "@/lib/api-wrapper"

// Split out of the main commande PATCH route on purpose: that route always requires a
// `status` transition and runs receipt numbering / income booking / stock adjustments
// alongside it — mixing preparation tracking into it would risk re-triggering that logic
// for what's really just a dashboard-facing checklist flag (FORM-119's "Commandes boutique
// à préparer" action, see dashboard-actions.ts).
const schema = z.object({
  // Flip off for an order a third party fulfills (not the association) — see
  // BoutiqueCommande.requiresPreparation's schema comment.
  requiresPreparation: z.boolean().optional(),
  // true marks the order prepared now; false reverts it (e.g. "marqué par erreur").
  prepared:             z.boolean().optional(),
}).refine(d => d.requiresPreparation !== undefined || d.prepared !== undefined, {
  message: "requiresPreparation ou prepared est requis",
})

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const guard = await guardModule(ctx.associationId, "boutique")
  if (guard) return guard

  const commande = await prisma.boutiqueCommande.findFirst({
    where:  { id, associationId: ctx.associationId },
    select: { id: true, status: true },
  })
  if (!commande) return NextResponse.json({ error: "Introuvable" }, { status: 404 })
  if (commande.status === "CANCELLED")
    return NextResponse.json({ error: "Impossible de modifier une commande annulée" }, { status: 422 })

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const { requiresPreparation, prepared } = parsed.data

  const updated = await prisma.boutiqueCommande.update({
    where: { id },
    data:  {
      ...(requiresPreparation !== undefined ? { requiresPreparation } : {}),
      ...(prepared !== undefined
        ? { preparedAt: prepared ? new Date() : null }
        // Resuming preparation (false → true) clears any preparedAt left over from before
        // it was delegated — otherwise the order could silently come back marked "already
        // prepared" without anyone actually re-confirming that, since the mark/cancel menu
        // item is hidden while requiresPreparation is false and has no other way to clear it.
        : requiresPreparation === true ? { preparedAt: null } : {}),
    },
    select: { id: true, requiresPreparation: true, preparedAt: true },
  })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "BOUTIQUE_COMMANDE_UPDATED",
    entity:        "BoutiqueCommande",
    entityId:      id,
    label:         prepared !== undefined
      ? (prepared ? "Marquée comme préparée" : "Préparation annulée")
      : (requiresPreparation ? "Préparation par l'association réactivée" : "Préparation déléguée à un tiers"),
  })

  return NextResponse.json(updated)
}, { area: "boutique" })
