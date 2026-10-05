import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { fournisseurUpdateSchema } from "@/lib/schemas"
import { writeActivityLog, computeFournisseurDiff } from "@/lib/activity-log"

// Comptabilité area (FORM-34). The old allowlist also let the Secrétaire in, although the sidebar
// only showed Fournisseurs to the finance roles; she now has no access here.
export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId } = ctx

  const fournisseur = await prisma.fournisseur.findFirst({
    where: { id, associationId, deletedAt: null },
  })

  if (!fournisseur) return NextResponse.json({ error: "Fournisseur introuvable" }, { status: 404 })
  return NextResponse.json(fournisseur)
}, { area: "comptabilite", module: "fournisseurs" })

export const PATCH = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.fournisseur.findFirst({ where: { id, associationId, deletedAt: null } })
  if (!existing) return NextResponse.json({ error: "Fournisseur introuvable" }, { status: 404 })

  const body = await req.json()
  const parsed = fournisseurUpdateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { tradeName, contactName, contactRole, siret, siren, vatNumber, address, city, postalCode, country, email, billingEmail, phone, website, category, notes, ...rest } = parsed.data

  const fournisseur = await prisma.fournisseur.update({
    where: { id },
    data: {
      ...rest,
      ...(tradeName    !== undefined ? { tradeName:    tradeName    || null } : {}),
      ...(contactName  !== undefined ? { contactName:  contactName  || null } : {}),
      ...(contactRole  !== undefined ? { contactRole:  contactRole  || null } : {}),
      ...(siret        !== undefined ? { siret:        siret        || null } : {}),
      ...(siren        !== undefined ? { siren:        siren        || null } : {}),
      ...(vatNumber    !== undefined ? { vatNumber:    vatNumber    || null } : {}),
      ...(address      !== undefined ? { address:      address      || null } : {}),
      ...(city         !== undefined ? { city:         city         || null } : {}),
      ...(postalCode   !== undefined ? { postalCode:   postalCode   || null } : {}),
      ...(country      !== undefined ? { country:      country      || "France" } : {}),
      ...(email        !== undefined ? { email:        email        || null } : {}),
      ...(billingEmail !== undefined ? { billingEmail: billingEmail || null } : {}),
      ...(phone        !== undefined ? { phone:        phone        || null } : {}),
      ...(website      !== undefined ? { website:      website      || null } : {}),
      ...(category     !== undefined ? { category:     category     || null } : {}),
      ...(notes        !== undefined ? { notes:        notes        || null } : {}),
    },
  })

  const changes = computeFournisseurDiff(
    existing    as unknown as Record<string, unknown>,
    fournisseur as unknown as Record<string, unknown>,
  )
  if (Object.keys(changes).length > 0) {
    await writeActivityLog({ associationId, actorId: userId, action: "FOURNISSEUR_UPDATED", entity: "Fournisseur", entityId: id, label: fournisseur.companyName, metadata: { changes } })
  }

  return NextResponse.json(fournisseur)
}, { area: "comptabilite", module: "fournisseurs" })

export const DELETE = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const existing = await prisma.fournisseur.findFirst({ where: { id, associationId, deletedAt: null } })
  if (!existing) return NextResponse.json({ error: "Fournisseur introuvable" }, { status: 404 })

  await prisma.fournisseur.update({ where: { id }, data: { deletedAt: new Date() } })

  await writeActivityLog({ associationId, actorId: userId, action: "FOURNISSEUR_DELETED", entity: "Fournisseur", entityId: id, label: existing.companyName })

  return new NextResponse(null, { status: 204 })
}, { area: "comptabilite", module: "fournisseurs" })
