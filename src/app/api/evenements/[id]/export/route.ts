import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { format } from "date-fns"
import { utils, write } from "xlsx"
import { withAdminAuth } from "@/lib/api-wrapper"

// Neutralize CSV/formula injection (Nom/Prénom/Email come from public, unauthenticated
// self-registration) — Excel/Sheets execute a cell starting with =, +, - or @ as a formula.
function sanitizeCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
}

const RSVP_LABELS: Record<string, string> = {
  CONFIRME: "J'y serai",
  PROVAVEL: "Si possible",
  INCERTO:  "Peut-être",
  ABSENT:   "Absent",
}

export const GET = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId } = ctx

  const fmt    = new URL(req.url).searchParams.get("format") ?? "csv"

  const evenement = await prisma.evenement.findFirst({ where: { id, associationId } })
  if (!evenement) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const membres = await prisma.membre.findMany({
    where:   { associationId, deletedAt: null, status: "ACTIF" },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: {
      participations: {
        where:  { evenementId: id },
        select: { present: true, rsvp: true, ticketPaidAt: true, quantity: true },
      },
    },
  })

  const slug    = evenement.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()
  const date    = format(evenement.date, "yyyy-MM-dd")
  const hasFee  = evenement.price != null && Number(evenement.price) > 0

  const rows = membres.map((m, i) => {
    const p = m.participations[0]
    const base = {
      "#":     i + 1,
      Nom:     sanitizeCell(m.lastName),
      Prénom:  sanitizeCell(m.firstName),
      Email:   sanitizeCell(m.email ?? ""),
      Présent: p?.present ? "Oui" : "Non",
    }
    if (hasFee) {
      return {
        ...base,
        Paiement: p?.ticketPaidAt ? "Payé" : p?.rsvp === "CONFIRME" ? "Réservé" : "",
        Places:   p?.quantity ?? "",
        RSVP:     "",
      }
    }
    return { ...base, RSVP: p?.rsvp ? (RSVP_LABELS[p.rsvp] ?? "") : "" }
  })

  if (fmt === "xlsx") {
    const ws = utils.json_to_sheet(rows)
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, "Présences")

    ws["!cols"] = hasFee
      ? [{ wch: 4 }, { wch: 20 }, { wch: 20 }, { wch: 28 }, { wch: 10 }, { wch: 14 }, { wch: 8 }, { wch: 14 }]
      : [{ wch: 4 }, { wch: 20 }, { wch: 20 }, { wch: 28 }, { wch: 10 }, { wch: 14 }]

    const buf = write(wb, { type: "buffer", bookType: "xlsx" })
    return new NextResponse(buf, {
      headers: {
        "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="presences_${date}_${slug}.xlsx"`,
      },
    })
  }

  const header = Object.keys(rows[0] ?? { "#": "", Nom: "", Prénom: "", Email: "", Présent: "", RSVP: "" }).join(",") + "\n"
  const csv    = header + rows.map(r =>
    Object.values(r).map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")
  ).join("\n")

  return new NextResponse(csv, {
    headers: {
      "Content-Type":        "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="presences_${date}_${slug}.csv"`,
    },
  })
})
