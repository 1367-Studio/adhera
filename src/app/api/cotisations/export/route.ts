import { NextResponse } from "next/server"
import { format } from "date-fns"
import { utils, write } from "xlsx"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { parseCotisationFilters, buildCotisationWhere, computeCotisationDistribution } from "@/lib/cotisation-query"

// Same reasoning as membres/export and billing/export — Nom/Prénom can come from public,
// unauthenticated self-registration, so a value starting with =, +, - or @ must be neutralized
// before it reaches Excel/Sheets as a cell.
function sanitizeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

const STATUS_LABELS: Record<string, string> = {
  EN_ATTENTE:          "En attente",
  PARTIELLEMENT_PAYEE: "Partiellement payée",
  PAYE:                "Payée",
  EN_RETARD:           "En retard",
  EXONERE:             "Exonérée",
  ANNULEE:             "Annulée",
}

const RENEWAL_LABELS = { AUTO: "Automatique", MANUAL: "Manuel" } as const

// Exports every cotisation matching the page's active filters (not just the visible page) plus
// the same "Voir la répartition" breakdown, so what a treasurer hands the board matches what
// they saw on screen. Mirrors src/app/api/membres/export/route.ts's xlsx pattern.
export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx
  const { searchParams } = new URL(req.url)
  const filters = parseCotisationFilters(searchParams)
  const where   = buildCotisationWhere(associationId, filters)

  const [cotisations, distribution] = await Promise.all([
    prisma.cotisation.findMany({
      where,
      orderBy: [{ membre: { lastName: "asc" } }, { year: "desc" }],
      include: {
        membre: { select: { firstName: true, lastName: true, email: true } },
        tier:   { select: { label: true } },
      },
    }),
    computeCotisationDistribution(associationId, filters),
  ])

  const detailRows = cotisations.map((c, i) => {
    const amount     = Number(c.amount)
    const amountPaid = Number(c.amountPaid)
    const remaining  = c.status === "EXONERE" || c.status === "ANNULEE" ? 0 : Math.max(amount - amountPaid, 0)
    return {
      "#":              i + 1,
      Membre:           sanitizeCell(`${c.membre.lastName} ${c.membre.firstName}`),
      Email:            sanitizeCell(c.membre.email ?? ""),
      Année:            c.year,
      Catégorie:        sanitizeCell(c.tier?.label ?? ""),
      Renouvellement:   RENEWAL_LABELS[c.subscriptionId ? "AUTO" : "MANUAL"],
      Montant:          amount,
      Payé:             amountPaid,
      "Reste à payer":  remaining,
      Statut:           STATUS_LABELS[c.status] ?? c.status,
      "Date de paiement": c.paidAt ? format(c.paidAt, "dd/MM/yyyy") : "",
    }
  })

  const distributionRows = [
    ...distribution.groups.map(g => ({
      Catégorie:            sanitizeCell(g.tierLabel ?? "Sans catégorie"),
      Renouvellement:       RENEWAL_LABELS[g.renewalMode],
      "Quantité":           g.count,
      "Total à payer":      g.aPagar,
      "Reçu":               g.recebido,
      "Solde à payer":      g.saldo,
    })),
    {
      Catégorie: "Total", Renouvellement: "",
      "Quantité": distribution.total.count,
      "Total à payer": distribution.total.aPagar,
      "Reçu": distribution.total.recebido,
      "Solde à payer": distribution.total.saldo,
    },
  ]

  const wb = utils.book_new()

  const wsDetail = utils.json_to_sheet(detailRows)
  wsDetail["!cols"] = [
    { wch: 4 }, { wch: 24 }, { wch: 26 }, { wch: 8 }, { wch: 18 }, { wch: 14 },
    { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 14 },
  ]
  utils.book_append_sheet(wb, wsDetail, "Cotisations")

  const wsDistribution = utils.json_to_sheet(distributionRows)
  wsDistribution["!cols"] = [{ wch: 20 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 12 }, { wch: 14 }]
  utils.book_append_sheet(wb, wsDistribution, "Répartition")

  const buf = write(wb, { type: "buffer", bookType: "xlsx" })
  return new NextResponse(buf, {
    headers: {
      "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="cotisations_${format(new Date(), "yyyy-MM-dd")}.xlsx"`,
    },
  })
}, { area: "adhesions" })
