import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { format } from "date-fns"
import { utils, write } from "xlsx"

const RSVP_LABELS: Record<string, string> = {
  CONFIRME: "J'y serai",
  PROVAVEL: "Si possible",
  INCERTO:  "Peut-être",
  ABSENT:   "Absent",
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId } = ctx

  const { id } = await params
  const fmt    = new URL(req.url).searchParams.get("format") ?? "csv"

  const evenement = await prisma.evenement.findFirst({ where: { id, associationId } })
  if (!evenement) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const membres = await prisma.membre.findMany({
    where:   { associationId, deletedAt: null, status: "ACTIF" },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    include: {
      participations: {
        where:  { evenementId: id },
        select: { present: true, rsvp: true },
      },
    },
  })

  const slug = evenement.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()
  const date = format(evenement.date, "yyyy-MM-dd")

  const rows = membres.map((m, i) => ({
    "#":       i + 1,
    Nom:       m.lastName,
    Prénom:    m.firstName,
    Email:     m.email ?? "",
    Présent:   m.participations[0]?.present ? "Oui" : "Non",
    RSVP:      m.participations[0]?.rsvp ? (RSVP_LABELS[m.participations[0].rsvp] ?? "") : "",
  }))

  if (fmt === "xlsx") {
    const ws = utils.json_to_sheet(rows)
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, "Présences")

    ws["!cols"] = [
      { wch: 4 }, { wch: 20 }, { wch: 20 }, { wch: 28 }, { wch: 10 }, { wch: 14 },
    ]

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
}
