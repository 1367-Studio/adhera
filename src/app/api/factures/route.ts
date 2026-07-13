import { NextResponse } from "next/server"
import { Prisma } from "@prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { factureCreateSchema } from "@/lib/schemas"
import { parsePagination } from "@/lib/pagination"
import { writeActivityLog } from "@/lib/activity-log"
import { computeDocumentTotals } from "@/lib/devis-calc"
import { deriveFactureStatus, factureStatusWhere, resolveManualStatus, type FactureStatus } from "@/lib/facture-status"
import { nextFactureNumber } from "@/lib/document-numbering"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]
const FINANCE  = ["ADMIN", "PRESIDENT", "TRESORIER"]

function withDerivedStatus<T extends { status: string; dueDate: Date | string | null }>(f: T): T {
  return { ...f, status: deriveFactureStatus(f.status as FactureStatus, f.dueDate) }
}

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const { searchParams } = new URL(req.url)
  const search        = searchParams.get("search")?.trim()
  const status         = searchParams.get("status") ?? undefined
  const fournisseurId = searchParams.get("fournisseurId") ?? undefined

  // status filters EN_RETARD/EN_ATTENTE/PARTIELLEMENT_PAYEE the same way — EN_RETARD is
  // never stored, so it needs a dueDate-vs-today condition rather than a plain equality
  // (see factureStatusWhere). Combined into `AND` alongside search so neither clause's
  // `OR` clobbers the other's.
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
  if (status) and.push(factureStatusWhere(status as FactureStatus))

  const where: Record<string, unknown> = { associationId, deletedAt: null, ...(and.length ? { AND: and } : {}) }

  const orderBy = [{ issueDate: "desc" as const }, { createdAt: "desc" as const }]
  const include = {
    fournisseur: { select: { id: true, companyName: true, email: true, billingEmail: true } },
    devis:       { select: { id: true, number: true } },
  }

  if (!searchParams.has("page")) {
    const data = await prisma.facture.findMany({ where, orderBy, include, take: 500 })
    return NextResponse.json(data.map(withDerivedStatus))
  }

  const { page, limit, skip } = parsePagination(searchParams)
  const [data, total] = await Promise.all([
    prisma.facture.findMany({ where, orderBy, skip, take: limit, include }),
    prisma.facture.count({ where }),
  ])
  return NextResponse.json({ data: data.map(withDerivedStatus), total, page, limit, totalPages: Math.ceil(total / limit) })
}, { roles: MANAGERS, module: "factures" })

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body   = await req.json()
  const parsed = factureCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  const { fournisseurId, devisId, status, issueDate, dueDate, notes, paymentTerms, items } = parsed.data

  if (fournisseurId) {
    const fournisseur = await prisma.fournisseur.findFirst({ where: { id: fournisseurId, associationId, deletedAt: null } })
    if (!fournisseur) return NextResponse.json({ error: "Fournisseur introuvable" }, { status: 404 })
  }
  if (devisId) {
    const devis = await prisma.devis.findFirst({ where: { id: devisId, associationId, deletedAt: null } })
    if (!devis) return NextResponse.json({ error: "Devis introuvable" }, { status: 404 })
    const alreadyLinked = await prisma.facture.findFirst({ where: { devisId } })
    if (alreadyLinked) return NextResponse.json({ error: "Ce devis est déjà lié à une facture" }, { status: 409 })
  }

  const totals = computeDocumentTotals(items)
  // amountPaid is always 0 on creation — PAYEE/PARTIELLEMENT_PAYEE can't be true yet, so a
  // client-sent value of either always resolves down to EN_ATTENTE (see resolveManualStatus).
  const resolvedStatus = resolveManualStatus(status, 0, totals.total)

  for (let attempt = 0; attempt < 5; attempt++) {
    const number = await nextFactureNumber(associationId)
    try {
      const facture = await prisma.facture.create({
        data: {
          associationId,
          fournisseurId: fournisseurId || null,
          devisId:       devisId       || null,
          number,
          status:       resolvedStatus,
          issueDate:    new Date(issueDate),
          dueDate:      dueDate ? new Date(dueDate) : null,
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

      await writeActivityLog({ associationId, actorId: userId, action: "FACTURE_CREATED", entity: "Facture", entityId: facture.id, label: facture.number })

      return NextResponse.json(withDerivedStatus(facture), { status: 201 })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue
      throw err
    }
  }

  return NextResponse.json({ error: "Impossible de générer un numéro de facture, réessayez" }, { status: 500 })
}, { roles: FINANCE, module: "factures" })
