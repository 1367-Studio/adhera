import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { format } from "date-fns"
import { utils, write } from "xlsx"
import { withAdminAuth } from "@/lib/api-wrapper"

// Same reasoning as evenements/[id]/export — Nom/Prénom/Email can come from public,
// unauthenticated self-registration (site-membership-section.tsx), so a value starting
// with =, +, - or @ must be neutralized before it reaches Excel/Sheets as a cell.
function sanitizeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

const CIVILITE_LABELS: Record<string, string> = { MME: "Mme", MLLE: "Mlle", M: "M." }
const GROUPE_SANGUIN_LABELS: Record<string, string> = {
  A_POSITIF: "A+", A_NEGATIF: "A-", B_POSITIF: "B+", B_NEGATIF: "B-",
  AB_POSITIF: "AB+", AB_NEGATIF: "AB-", O_POSITIF: "O+", O_NEGATIF: "O-",
}
const STATUS_LABELS: Record<string, string> = {
  PENDING: "En attente", ACTIF: "Actif", INACTIF: "Inactif", SUSPENDU: "Suspendu",
}

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx
  const { searchParams } = new URL(req.url)

  const fmt      = searchParams.get("format") ?? "json"
  const search   = searchParams.get("search")?.trim()
  const status   = searchParams.get("status") ?? undefined
  const typeId   = searchParams.get("typeId") ?? undefined

  // Mirrors the same where-building logic as GET /api/membres — deliberately duplicated
  // rather than imported, so pagination and export stay independently testable/changeable.
  const where: Record<string, unknown> = { associationId, deletedAt: null }
  if (status) where.status = status
  if (typeId) where.typeId = typeId
  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: "insensitive" } },
      { lastName:  { contains: search, mode: "insensitive" } },
      { email:     { contains: search, mode: "insensitive" } },
    ]
  }

  const membres = await prisma.membre.findMany({
    where,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: { type: { select: { name: true } } },
  })

  const rows = membres.map((m, i) => ({
    "#":               i + 1,
    Civilité:          m.civilite ? CIVILITE_LABELS[m.civilite] : "",
    Nom:               sanitizeCell(m.lastName),
    Prénom:            sanitizeCell(m.firstName),
    Email:             sanitizeCell(m.email ?? ""),
    Téléphone:         sanitizeCell(m.phone ?? ""),
    Adresse:           sanitizeCell(m.address ?? ""),
    "Date de naissance": m.birthDate ? format(m.birthDate, "dd/MM/yyyy") : "",
    "Groupe sanguin":  m.groupeSanguin ? GROUPE_SANGUIN_LABELS[m.groupeSanguin] : "",
    Allergies:         sanitizeCell(m.allergies ?? ""),
    Statut:            STATUS_LABELS[m.status] ?? m.status,
    Type:              m.type?.name ?? "",
    Adhésion:          format(m.joinedAt, "dd/MM/yyyy"),
  }))

  if (fmt === "xlsx") {
    const ws = utils.json_to_sheet(rows)
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, "Membres")

    ws["!cols"] = [
      { wch: 4 }, { wch: 8 }, { wch: 20 }, { wch: 20 }, { wch: 28 },
      { wch: 16 }, { wch: 30 }, { wch: 14 }, { wch: 12 }, { wch: 24 },
      { wch: 12 }, { wch: 16 }, { wch: 14 },
    ]

    const buf = write(wb, { type: "buffer", bookType: "xlsx" })
    return new NextResponse(buf, {
      headers: {
        "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="membres_${format(new Date(), "yyyy-MM-dd")}.xlsx"`,
      },
    })
  }

  // Plain JSON — consumed client-side by the PDF export, which builds the jspdf-autotable
  // document with the same branded header used elsewhere (declaration, presences).
  return NextResponse.json(rows)
})
