import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { devisCreateSchema } from "@/lib/schemas"
import { parsePagination } from "@/lib/pagination"
import { writeActivityLog } from "@/lib/activity-log"
import { computeDocumentTotals, exceedsMaxTotal, MAX_DOCUMENT_TOTAL } from "@/lib/devis-calc"
import { nextDevisNumber } from "@/lib/document-numbering"
import { deriveDevisStatus, devisStatusWhere, type DevisStatus } from "@/lib/devis-status"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]
const FINANCE  = ["ADMIN", "PRESIDENT", "TRESORIER"]

function withDerivedStatus<T extends { status: string; validUntil: Date | string | null }>(d: T): T {
  return { ...d, status: deriveDevisStatus(d.status as DevisStatus, d.validUntil) }
}

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const { searchParams } = new URL(req.url)
  const search        = searchParams.get("search")?.trim()
  const status         = searchParams.get("status") ?? undefined
  const fournisseurId = searchParams.get("fournisseurId") ?? undefined

  // status filtering goes through devisStatusWhere rather than a plain equality: EXPIRE can
  // be either stored directly or derived from an ENVOYE devis past its validUntil, and
  // ENVOYE must exclude the latter (see devis-status.ts). Combined into `AND` alongside
  // search so neither clause's `OR` clobbers the other's.
  const and: Record<string, unknown>[] = []
  if (fournisseurId) and.push({ fournisseurId })
  if (search) {
    and.push({
      OR: [
        { number: { contains: search, mode: "insensitive" } },
        { fournisseur: { companyName: { contains: search, mode: "insensitive" } } },
      ],
    })
  }
  if (status) and.push(devisStatusWhere(status as DevisStatus))

  const where: Record<string, unknown> = { associationId, deletedAt: null, ...(and.length ? { AND: and } : {}) }

  const orderBy = [{ issueDate: "desc" as const }, { createdAt: "desc" as const }]
  const include = {
    fournisseur: { select: { id: true, companyName: true, email: true, billingEmail: true } },
    facture:     { select: { id: true } },
  }

  if (!searchParams.has("page")) {
    const data = await prisma.devis.findMany({ where, orderBy, include, take: 500 })
    return NextResponse.json(data.map(withDerivedStatus))
  }

  const { page, limit, skip } = parsePagination(searchParams)
  const [data, total] = await Promise.all([
    prisma.devis.findMany({ where, orderBy, skip, take: limit, include }),
    prisma.devis.count({ where }),
  ])
  return NextResponse.json({ data: data.map(withDerivedStatus), total, page, limit, totalPages: Math.ceil(total / limit) })
}, { roles: MANAGERS, module: "devis" })

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body   = await req.json()
  const parsed = devisCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { fournisseurId, status, issueDate, validUntil, notes, paymentTerms, items } = parsed.data

  if (fournisseurId) {
    const fournisseur = await prisma.fournisseur.findFirst({ where: { id: fournisseurId, associationId, deletedAt: null } })
    if (!fournisseur) return NextResponse.json({ error: "Fournisseur introuvable" }, { status: 404 })
  }

  const totals = computeDocumentTotals(items)
  if (exceedsMaxTotal(totals)) {
    return NextResponse.json({ error: `Le total du devis dépasse le maximum autorisé (${MAX_DOCUMENT_TOTAL.toLocaleString("fr-FR")} €)` }, { status: 422 })
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const number = await nextDevisNumber(associationId)
    try {
      const devis = await prisma.devis.create({
        data: {
          associationId,
          fournisseurId: fournisseurId || null,
          number,
          status,
          issueDate:    new Date(issueDate),
          validUntil:   validUntil ? new Date(validUntil) : null,
          notes:        notes        || null,
          paymentTerms: paymentTerms || null,
          ...totals,
          items: {
            create: items.map((item, order) => ({
              description: item.description,
              quantity:    item.quantity,
              unitPrice:   item.unitPrice,
              vatRate:     item.vatRate,
              discount:    item.discount,
              order,
            })),
          },
        },
        include: { items: true, fournisseur: { select: { id: true, companyName: true } } },
      })

      await writeActivityLog({ associationId, actorId: userId, action: "DEVIS_CREATED", entity: "Devis", entityId: devis.id, label: devis.number })

      return NextResponse.json(devis, { status: 201 })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue
      throw err
    }
  }

  return NextResponse.json({ error: "Impossible de générer un numéro de devis, réessayez" }, { status: 500 })
}, { roles: FINANCE, module: "devis" })
