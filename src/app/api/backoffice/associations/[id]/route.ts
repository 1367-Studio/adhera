import { NextResponse }  from "next/server"
import { prisma }        from "@/lib/prisma/client"
import { z }             from "zod"
import { withSuperAdminAuth } from "@/lib/api-wrapper"
import { writeActivityLog, computeAssociationDiff } from "@/lib/activity-log"
import { revalidatePublicSiteFor } from "@/lib/association/revalidate-site"
import { reportError } from "@/lib/monitoring"
import { DEFAULT_MODULES } from "@/lib/modules"

// Derived from DEFAULT_MODULES's own keys rather than hand-listed — a hand-listed copy here
// is exactly how "reimbursements" went missing when FORM-93 added it to AssocModules: the
// shape still parsed successfully (zod silently drops unrecognized keys instead of failing),
// so the toggle UI showed "saved" while the new flag was never actually persisted, and every
// subsequent save of ANY module wiped it out again (this route replaces the whole `modules`
// JSON column, it doesn't merge). Deriving the key list here means a future new module can't
// go missing from this schema the same way.
const modulesSchema = z.object(
  Object.fromEntries(Object.keys(DEFAULT_MODULES).map(key => [key, z.boolean()])),
)

const patchSchema = z.object({
  internalNotes: z.string().optional(),
  // Staff override for a negotiated "sur mesure" member cap — null explicitly clears it
  // (falls back to the association's tier default), omitted leaves it untouched.
  customMemberLimit: z.number().int().positive().nullable().optional(),
  // Staff override to force custom branding (logo/colors) on for a specific Essentiel
  // association — see canUseCustomBranding() in src/lib/plan-limits.ts. null falls back
  // to the plan default (Pro), omitted leaves it untouched.
  customBrandingEnabled: z.boolean().nullable().optional(),
  modules: modulesSchema.optional(),
})

export const PATCH = withSuperAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const body   = await req.json()
  const parsed = patchSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Données invalides" }, { status: 422 })
  }

  const data = parsed.data
  const update: Record<string, unknown> = {}
  if (data.internalNotes         !== undefined) update.internalNotes         = data.internalNotes
  if (data.customMemberLimit     !== undefined) update.customMemberLimit     = data.customMemberLimit
  if (data.customBrandingEnabled !== undefined) update.customBrandingEnabled = data.customBrandingEnabled
  if (data.modules               !== undefined) update.modules               = data.modules

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "Rien à mettre à jour" }, { status: 400 })
  }

  try {
    const existing = await prisma.association.findUnique({
      where:  { id },
      select: { name: true, deletedAt: true, internalNotes: true, customMemberLimit: true, customBrandingEnabled: true, modules: true },
    })
    if (!existing || existing.deletedAt !== null) {
      return NextResponse.json({ error: "Association introuvable" }, { status: 404 })
    }
    const updated = await prisma.association.update({ where: { id }, data: update })

    // "site" is one of the toggled modules and gates whether `/[slug]` renders at all —
    // bust its cache whenever modules change so a staff toggle takes effect immediately.
    if (data.modules !== undefined) await revalidatePublicSiteFor(id)

    const changes = computeAssociationDiff(
      existing as unknown as Record<string, unknown>,
      updated  as unknown as Record<string, unknown>,
    )
    if (Object.keys(changes).length > 0) {
      await writeActivityLog({
        associationId: id, actorId: ctx.userId, action: "ASSOCIATION_UPDATED",
        entity: "Association", entityId: id, label: existing.name, metadata: { changes },
      })
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    reportError(error, { area: "api", action: "backoffice.association-update", extra: { associationId: id } })
    return NextResponse.json({ error: "Erreur interne" }, { status: 500 })
  }
})
