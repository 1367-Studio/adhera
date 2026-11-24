import { NextResponse } from "next/server"
import { utils, write } from "xlsx"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { buildLicenseWhere } from "@/app/api/licencas/route"

// Same formula-injection guard as membres/cotisations/billing export — Nom/Prénom can come
// from public, unauthenticated self-registration.
function sanitizeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

const STATUS_LABELS: Record<string, string> = {
  A_SOLICITAR:  "À demander",
  EM_ANDAMENTO: "En cours",
  VALIDADA:     "Validée",
  A_RENOVAR:    "À renouveler",
}

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx
  const { searchParams } = new URL(req.url)
  const where = buildLicenseWhere(associationId, searchParams)

  const licenses = await prisma.membershipLicense.findMany({
    where,
    orderBy: [{ season: "desc" }, { membre: { lastName: "asc" } }],
    include: {
      membre:     { select: { firstName: true, lastName: true } },
      cotisation: { select: { year: true, tier: { select: { label: true } } } },
    },
  })

  const rows = licenses.map((l, i) => ({
    "#":            i + 1,
    Membre:         sanitizeCell(`${l.membre.lastName} ${l.membre.firstName}`),
    Modalité:       sanitizeCell(l.cotisation.tier?.label ?? ""),
    Fédération:     sanitizeCell(l.federation),
    Saison:         sanitizeCell(l.season),
    "Numéro de licence": sanitizeCell(l.licenseNumber ?? ""),
    Statut:         STATUS_LABELS[l.status] ?? l.status,
    "Déclarée par le membre": l.declaredByMembre ? "Oui" : "Non",
    "Renouvelée automatiquement": l.autoRenewed ? "Oui" : "Non",
  }))

  const wb = utils.book_new()
  const ws = utils.json_to_sheet(rows)
  ws["!cols"] = [{ wch: 4 }, { wch: 24 }, { wch: 18 }, { wch: 16 }, { wch: 12 }, { wch: 16 }, { wch: 14 }, { wch: 18 }, { wch: 18 }]
  utils.book_append_sheet(wb, ws, "Licences")

  const buf = write(wb, { type: "buffer", bookType: "xlsx" })
  return new NextResponse(buf, {
    headers: {
      "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="licences.xlsx"`,
    },
  })
}, { area: "adhesions", module: "cotisations" })
