import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { format } from "date-fns"
import { utils, write } from "xlsx"
import { withAdminAuth } from "@/lib/api-wrapper"
import { membreAdherentWhereClause } from "@/lib/membre-adherent"

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
const SEXE_LABELS: Record<string, string> = { HOMME: "Homme", FEMME: "Femme" }

// Matches the role gate on GET /api/membres (src/app/api/membres/route.ts) — this export
// returns the same data in bulk, so it shouldn't be reachable by anyone the list itself
// already excludes.
const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx
  const { searchParams } = new URL(req.url)

  const fmt      = searchParams.get("format") ?? "json"
  const search   = searchParams.get("search")?.trim()
  const status   = searchParams.get("status") ?? undefined
  const typeId   = searchParams.get("typeId") ?? undefined
  // Adds every remaining "fiche" field (see src/lib/pdf/fiche-membre-vierge.ts, the blank
  // intake form these mirror) beyond the default column set below — opt-in so the existing
  // membres page export keeps its current column layout unchanged.
  const full     = searchParams.get("full") === "1"
  const firstName = searchParams.get("firstName")?.trim()
  const lastName  = searchParams.get("lastName")?.trim()
  const address   = searchParams.get("address")?.trim()
  const adherent  = searchParams.get("adherent") ?? undefined // "ADHERENT" | "BENEVOLE"

  // Mirrors the same where-building logic as GET /api/membres — deliberately duplicated
  // rather than imported, so pagination and export stay independently testable/changeable.
  // Every filter the list understands must be understood here too: an export that ignored
  // one would hand back rows the admin had explicitly filtered out on screen.
  const where: Record<string, unknown> = { associationId, deletedAt: null }
  if (status) where.status = status
  if (typeId) where.typeId = typeId
  if (firstName) where.firstName = { contains: firstName, mode: "insensitive" }
  if (lastName)  where.lastName  = { contains: lastName,  mode: "insensitive" }
  if (address)   where.address   = { contains: address,   mode: "insensitive" }
  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: "insensitive" } },
      { lastName:  { contains: search, mode: "insensitive" } },
      { email:     { contains: search, mode: "insensitive" } },
    ]
  }

  const and: Record<string, unknown>[] = []
  for (const [param, bound] of [["birthDateFrom", "gte"], ["birthDateTo", "lte"]] as const) {
    const raw = searchParams.get(param)?.trim()
    if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) continue
    and.push({ birthDate: bound === "gte" ? { gte: new Date(`${raw}T00:00:00.000Z`) } : { lte: new Date(`${raw}T23:59:59.999Z`) } })
  }
  if (adherent === "ADHERENT" || adherent === "BENEVOLE") {
    and.push(membreAdherentWhereClause(adherent === "ADHERENT"))
  }
  if (and.length) where.AND = and

  const membres = await prisma.membre.findMany({
    where,
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: {
      type: { select: { name: true } },
      ...(full ? { responsable: { select: { firstName: true, lastName: true } } } : {}),
    },
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
    ...(full ? { Sexe: m.sexe ? SEXE_LABELS[m.sexe] : "" } : {}),
    "Groupe sanguin":  m.groupeSanguin ? GROUPE_SANGUIN_LABELS[m.groupeSanguin] : "",
    Allergies:         sanitizeCell(m.allergies ?? ""),
    ...(full ? {
      "Possède un tee-shirt": m.possedeTshirt == null ? "" : (m.possedeTshirt ? "Oui" : "Non"),
      "Taille tee-shirt":     m.tailleTshirt ?? "",
      "Langue parlée":        m.spokenLanguage ?? "",
      "Responsable légal":    m.responsable ? `${sanitizeCell(m.responsable.firstName)} ${sanitizeCell(m.responsable.lastName)}` : "",
    } : {}),
    Statut:            STATUS_LABELS[m.status] ?? m.status,
    Type:              m.type?.name ?? "",
    Adhésion:          format(m.joinedAt, "dd/MM/yyyy"),
  }))

  if (fmt === "xlsx") {
    const ws = utils.json_to_sheet(rows)
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, "Membres")

    // Keyed by header name (not position) so widths stay correct whether or not `full`
    // inserted extra columns in between — unlisted headers fall back to a plain default.
    const COLUMN_WIDTHS: Record<string, number> = {
      "#": 4, Civilité: 8, Nom: 20, Prénom: 20, Email: 28, Téléphone: 16, Adresse: 30,
      "Date de naissance": 14, Sexe: 10, "Groupe sanguin": 12, Allergies: 24,
      "Possède un tee-shirt": 12, "Taille tee-shirt": 12, "Responsable légal": 24,
      Statut: 12, Type: 16, Adhésion: 14,
    }
    ws["!cols"] = Object.keys(rows[0] ?? {}).map(key => ({ wch: COLUMN_WIDTHS[key] ?? 16 }))

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
}, { roles: MANAGERS })
