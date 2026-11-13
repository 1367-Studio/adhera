import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { factureRecueCreateSchema } from "@/lib/schemas"
import { parsePagination } from "@/lib/pagination"
import { writeActivityLog } from "@/lib/activity-log"
import { resolveManualFactureRecueStatus } from "@/lib/facture-recue-status"

// Comptabilité area (FORM-34). The old GET/DELETE allowlists also let the Secrétaire in, although
// the sidebar never showed her this screen and every write was finance-only; she now has no access here.
export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const { searchParams } = new URL(req.url)
  const status         = searchParams.get("status") ?? undefined
  const fournisseurId = searchParams.get("fournisseurId") ?? undefined

  const where: Record<string, unknown> = { associationId, deletedAt: null }
  if (status) where.status = status
  if (fournisseurId) where.fournisseurId = fournisseurId

  const orderBy = [{ issueDate: "desc" as const }, { createdAt: "desc" as const }]
  const include = { fournisseur: { select: { id: true, companyName: true } } }

  if (!searchParams.has("page")) {
    const data = await prisma.factureRecue.findMany({ where, orderBy, include, take: 500 })
    return NextResponse.json(data)
  }

  const { page, limit, skip } = parsePagination(searchParams)
  const [data, total] = await Promise.all([
    prisma.factureRecue.findMany({ where, orderBy, skip, take: limit, include }),
    prisma.factureRecue.count({ where }),
  ])
  return NextResponse.json({ data, total, page, limit, totalPages: Math.ceil(total / limit) })
}, { area: "comptabilite", module: "fournisseurs" })

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body   = await req.json()
  const parsed = factureRecueCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { fournisseurId, number, type, issueDate, amount, status, fileUrl, notes } = parsed.data

  if (fournisseurId) {
    const fournisseur = await prisma.fournisseur.findFirst({ where: { id: fournisseurId, associationId, deletedAt: null } })
    if (!fournisseur) return NextResponse.json({ error: "Fournisseur introuvable" }, { status: 404 })
  }

  // amountPaid is always 0 at creation (FORM-107 Fase 3) — a document is never created
  // "already payée" directly, that's only ever a consequence of recording a real payment via
  // POST .../payments right after. A client-sent PAYEE/PARTIELLEMENT_PAYEE with no payment yet
  // resolves back down to A_PAYER, same posture as Facture's own creation route.
  const resolvedStatus = resolveManualFactureRecueStatus(status, 0, amount)

  const factureRecue = await prisma.factureRecue.create({
    data: {
      associationId,
      fournisseurId: fournisseurId || null,
      number:        number        || null,
      type,
      issueDate: new Date(issueDate),
      amount,
      status: resolvedStatus,
      fileUrl,
      notes: notes || null,
    },
    include: { fournisseur: { select: { id: true, companyName: true } } },
  })

  await writeActivityLog({ associationId, actorId: userId, action: "FACTURE_RECUE_CREATED", entity: "FactureRecue", entityId: factureRecue.id, label: factureRecue.number ?? factureRecue.type })

  return NextResponse.json(factureRecue, { status: 201 })
}, { area: "comptabilite", module: "fournisseurs" })
