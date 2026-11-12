import { NextResponse } from "next/server"
import { format } from "date-fns"
import { utils, write } from "xlsx"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { canReadGrupo } from "@/lib/grupos/access"
import { dateOnlyToLocal } from "@/lib/date-format"

// Neutralize CSV/formula injection, same rule as every other export in the app.
function sanitizeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

const STATUS_LABELS: Record<string, string> = {
  PRESENTE:             "Présent",
  AUSENTE:              "Absent",
  AUSENCIA_JUSTIFICADA: "Absence justifiée",
  NAO_INFORMADO:        "Non renseigné",
}

export const GET = withAdminAuth<{ id: string; chamadaId: string }>(async (req, ctx, { id, chamadaId }) => {
  const { associationId, userId, permissions } = ctx

  const grupo = await prisma.grupo.findFirst({ where: { id, associationId } })
  if (!grupo) return NextResponse.json({ error: "Groupe introuvable" }, { status: 404 })
  if (!(await canReadGrupo(permissions, userId, id))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })
  }

  const sessao = await prisma.chamadaSessao.findFirst({
    where:   { id: chamadaId, grupoId: id },
    include: { presencas: { include: { membre: { select: { firstName: true, lastName: true } } }, orderBy: { membre: { lastName: "asc" } } } },
  })
  if (!sessao) return NextResponse.json({ error: "Appel introuvable" }, { status: 404 })

  // ?blank=1 : feuille vierge pour impression (colonne Statut vide) au lieu des statuts
  // réellement enregistrés.
  const blank = new URL(req.url).searchParams.get("blank") === "1"
  const date  = format(dateOnlyToLocal(sessao.data), "yyyy-MM-dd")
  const slug  = grupo.nome.replace(/[^a-z0-9]/gi, "_").toLowerCase()

  const rows = sessao.presencas.map((presenca, i) => ({
    "#":      i + 1,
    Nom:      sanitizeCell(presenca.membre.lastName),
    Prénom:   sanitizeCell(presenca.membre.firstName),
    Statut:   blank ? "" : STATUS_LABELS[presenca.status],
  }))

  const ws = utils.json_to_sheet(rows.length ? rows : [{ "#": "", Nom: "", Prénom: "", Statut: "" }])
  ws["!cols"] = [{ wch: 4 }, { wch: 20 }, { wch: 20 }, { wch: 20 }]
  const wb = utils.book_new()
  utils.book_append_sheet(wb, ws, "Présences")

  const buf = write(wb, { type: "buffer", bookType: "xlsx" })
  return new NextResponse(buf, {
    headers: {
      "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="appel_${date}_${slug}${blank ? "_vierge" : ""}.xlsx"`,
    },
  })
}, { module: "groupes" })
