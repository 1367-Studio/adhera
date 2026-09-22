import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { memberCardSettingsSchema, parseMemberCardSettings } from "@/lib/member-card/settings"

// Same allowlist as /api/association/branding — the card's look is part of the association's
// identity, not of its finances. Spelled out rather than relying on withAdminAuth's default:
// without `roles`, the wrapper lets *any* authenticated association session through, portal
// MEMBRE accounts included, and a member could then turn their own association's card off.
//
// Both handlers are also module-gated on cotisations, like every surface that reads these
// settings (the portal card routes, the manager's): a card only exists on top of a cotisation,
// so an association without that module has nothing to configure here.
const ADMINS = ["ADMIN", "PRESIDENT"]

export const GET = withAdminAuth(async (_req, ctx) => {
  const association = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { memberCardSettings: true },
  })
  if (!association) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  // Never the raw Json column: parseMemberCardSettings fills in every field that a row
  // written by an older version (or by hand) is missing, so the settings screen always
  // receives a complete object.
  return NextResponse.json(parseMemberCardSettings(association.memberCardSettings))
}, { roles: ADMINS, module: "cotisations" })

export const PATCH = withAdminAuth(async (req, ctx) => {
  const body   = await req.json().catch(() => null)
  // Strict schema, not the lenient reader: what an admin submits must be right or rejected,
  // otherwise a UI bug would silently save a card that looks nothing like what they picked.
  const parsed = memberCardSettingsSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: "Paramètres de carte de membre invalides" }, { status: 422 })
  }

  await prisma.association.update({
    where: { id: ctx.associationId },
    data:  { memberCardSettings: parsed.data },
  })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "ASSOCIATION_UPDATED",
    entity:        "Association",
    entityId:      ctx.associationId,
    label:         "Carte de membre",
  })

  return NextResponse.json(parsed.data)
}, { roles: ADMINS, module: "cotisations" })
