import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { fournisseurCreateSchema } from "@/lib/schemas"
import { parsePagination } from "@/lib/pagination"
import { writeActivityLog } from "@/lib/activity-log"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const { searchParams } = new URL(req.url)
  const search = searchParams.get("search")?.trim()
  const status = searchParams.get("status") ?? undefined
  const includeId = searchParams.get("includeId") ?? undefined

  const where: Record<string, unknown> = { associationId, deletedAt: null }
  if (status) where.status = status
  if (search) {
    where.OR = [
      { companyName: { contains: search, mode: "insensitive" } },
      { tradeName:    { contains: search, mode: "insensitive" } },
      { contactName:  { contains: search, mode: "insensitive" } },
      { email:        { contains: search, mode: "insensitive" } },
    ]
  }

  const orderBy = [{ companyName: "asc" as const }]

  if (!searchParams.has("page")) {
    // includeId is for select dropdowns: a Devis/Facture already linked to a fournisseur
    // that's since been archived (deletedAt set) or gone INACTIF still needs that option
    // to exist in the list, otherwise the field renders as if the link had vanished. Only
    // relaxes deletedAt/status for that one specific id, not the list at large.
    const dropdownWhere = includeId
      ? { associationId, OR: [{ deletedAt: null, ...(status ? { status } : {}) }, { id: includeId }] }
      : where
    const data = await prisma.fournisseur.findMany({ where: dropdownWhere, orderBy, take: 500 })
    return NextResponse.json(data)
  }

  const { page, limit, skip } = parsePagination(searchParams)
  const [data, total] = await Promise.all([
    prisma.fournisseur.findMany({ where, orderBy, skip, take: limit }),
    prisma.fournisseur.count({ where }),
  ])
  return NextResponse.json({ data, total, page, limit, totalPages: Math.ceil(total / limit) })
}, { roles: MANAGERS, module: "fournisseurs" })

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body = await req.json()
  const parsed = fournisseurCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { tradeName, contactName, contactRole, siret, siren, vatNumber, address, city, postalCode, country, email, billingEmail, phone, website, category, notes, ...rest } = parsed.data

  const fournisseur = await prisma.fournisseur.create({
    data: {
      ...rest,
      associationId,
      tradeName:    tradeName    || null,
      contactName:  contactName  || null,
      contactRole:  contactRole  || null,
      siret:        siret        || null,
      siren:        siren        || null,
      vatNumber:    vatNumber    || null,
      address:      address      || null,
      city:         city         || null,
      postalCode:   postalCode   || null,
      country:      country      || "France",
      email:        email        || null,
      billingEmail: billingEmail || null,
      phone:        phone        || null,
      website:      website      || null,
      category:     category     || null,
      notes:        notes        || null,
    },
  })

  await writeActivityLog({ associationId, actorId: userId, action: "FOURNISSEUR_CREATED", entity: "Fournisseur", entityId: fournisseur.id, label: fournisseur.companyName })

  return NextResponse.json(fournisseur, { status: 201 })
}, { roles: MANAGERS, module: "fournisseurs" })
