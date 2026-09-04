import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { parsePagination } from "@/lib/pagination"
import { withAdminAuth } from "@/lib/api-wrapper"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

export const GET = withAdminAuth(async (req, ctx) => {
  if (!FINANCE.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const { associationId } = ctx
  const { searchParams } = new URL(req.url)

  const year          = searchParams.get("year")
  const search        = searchParams.get("search")?.trim()
  const origin        = searchParams.get("origin") ?? undefined
  const receiptsOnly  = searchParams.get("receiptsOnly") === "true"
  // Offline dons (espèces/chèque/virement) awaiting encaissement — the one other state
  // besides "paid" this table needs to surface, so an admin has somewhere to see and
  // action them. Mutually exclusive with receiptsOnly (a pending don has no receipt yet).
  const pendingOnly   = searchParams.get("pendingOnly") === "true"

  const where: Record<string, unknown> = pendingOnly
    ? { associationId, paidAt: null, paymentMethod: { in: ["ESPECES", "CHEQUE", "VIREMENT"] } }
    : {
        associationId,
        paidAt: { not: null },
        ...(receiptsOnly ? { receiptNumber: { not: null } } : {}),
      }

  if (year && !pendingOnly) {
    const y = parseInt(year)
    if (!Number.isNaN(y)) {
      where.paidAt = {
        gte: new Date(`${y}-01-01`),
        lt:  new Date(`${y + 1}-01-01`),
      }
    }
  }

  if (search) {
    where.OR = [
      { firstName:   { contains: search, mode: "insensitive" } },
      { lastName:    { contains: search, mode: "insensitive" } },
      { companyName: { contains: search, mode: "insensitive" } },
      { email:       { contains: search, mode: "insensitive" } },
      { message:     { contains: search, mode: "insensitive" } },
    ]
  }

  // Plain field equality for every branch (never `where.OR`, unlike `search` above) so this
  // never collides with the free-text search — both can be active together, and
  // aggregateWhere's blind `delete aggregateWhere.OR` below only strips `search` from the KPI
  // totals, never this filter.
  if (origin === "form")            where.donationFormId       = { not: null }
  if (origin === "adhesion")        where.membershipAddonTierId = { not: null }
  if (origin === "evenementTicket") where.evenementTicketTypeId = { not: null }
  // The post-registration donation prompt (event-donation-prompt.tsx) sets evenementId
  // without evenementTicketTypeId — the `null` guard keeps this bucket exclusive of
  // evenementTicket above, since a ticket-embedded don never has evenementId set anyway (see
  // createEvenementDonation) but relying on that invariant here would be a silent trap.
  if (origin === "evenementPrompt") {
    where.evenementId           = { not: null }
    where.evenementTicketTypeId = null
  }
  if (origin === "standalone") {
    where.donationFormId        = null
    where.membershipAddonTierId = null
    where.evenementTicketTypeId = null
    where.evenementId           = null
  }

  // KPI totals intentionally ignore `search` — they summarize the year, not the filtered
  // list, so typing in the search box doesn't make the summary cards jump around.
  const aggregateWhere = { ...where }
  delete aggregateWhere.OR

  const orderBy = { paidAt: "desc" as const }

  const { page, limit, skip } = parsePagination(searchParams)
  const [data, total, aggregate] = await Promise.all([
    prisma.don.findMany({
      where, orderBy, skip, take: limit,
      include: {
        donationForm: { select: { id: true, title: true } },
        // Only set for a don embarqué on a MembershipForm signup (see Don.membershipAddonTierId)
        // — lets the pending-encaissement table point back at the member and the tier that
        // produced it, since that member also has an independent Cotisation pending its own
        // encaissement for the same physical payment (see checkout/route.ts's offline branch).
        membershipAddonTier: { select: { label: true } },
        // Set for a don embarqué on an event ticket type (Don.evenementTicketTypeId) — lets
        // the "origine" column point back at the event.
        evenementTicketType: { select: { evenement: { select: { id: true, title: true } } } },
        // Set for a don triggered by the post-registration donation prompt on an event
        // (Don.evenementId, see event-donation-prompt.tsx) — a different flow from the ticket
        // add-on above, but the same "came from an event" origin from an admin's viewpoint.
        evenement: { select: { id: true, title: true } },
      },
    }),
    prisma.don.count({ where }),
    prisma.don.aggregate({ where: aggregateWhere, _sum: { amount: true }, _count: { id: true } }),
  ])

  return NextResponse.json({
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    totalAmount: Number(aggregate._sum.amount ?? 0),
    totalCount:  aggregate._count.id,
  })
})
