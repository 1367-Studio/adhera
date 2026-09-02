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

  const evenement = await prisma.evenement.findFirst({
    where:   { id, associationId },
    include: { customFields: { orderBy: { order: "asc" } }, ticketTypes: { orderBy: { order: "asc" } } },
  })
  if (!evenement) return NextResponse.json({ error: "Not found" }, { status: 404 })

  // Same reasoning as /participations: only people with a real link to this event —
  // a ticket, an RSVP, a companion, or a guest added at the door. See that route's own
  // comment for why every active member used to be listed here regardless.
  const participations = await prisma.participation.findMany({
    where:  { evenementId: id },
    select: { membreId: true, firstName: true, lastName: true, email: true, phone: true, address: true, answers: true, present: true, rsvp: true, ticketPaidAt: true, amount: true, ticketTypeId: true },
  })

  const slug    = evenement.title.replace(/[^a-z0-9]/gi, "_").toLowerCase()
  const date    = format(evenement.date, "yyyy-MM-dd")
  const hasTicketTypes = evenement.ticketTypes.length > 0
  const hasFee  = hasTicketTypes || (evenement.price != null && Number(evenement.price) > 0)
  const ticketTypeLabels = new Map(evenement.ticketTypes.map(tt => [tt.id, tt.label]))

  const allRows = participations.map(p => ({ firstName: p.firstName, lastName: p.lastName, email: p.email, p }))

  // One column per custom field configured on this event — active members never fill
  // these (they're only asked on the public registration form), so their cells stay
  // blank, same as Téléphone/Adresse below.
  const customFieldColumns = Object.fromEntries(
    evenement.customFields.map(f => [f.label, (p?: { answers: unknown }) => {
      const answers = p?.answers as Record<string, string> | null
      return sanitizeCell(answers?.[f.id] ?? "")
    }]),
  )

  const rows = allRows.map((m, i) => {
    const p = m.p
    const base = {
      "#":       i + 1,
      Nom:       sanitizeCell(m.lastName),
      Prénom:    sanitizeCell(m.firstName),
      Email:     sanitizeCell(m.email ?? ""),
      Téléphone: sanitizeCell(p?.phone ?? ""),
      Adresse:   sanitizeCell(p?.address ?? ""),
      Présent:   p?.present ? "Oui" : "Non",
    }
    const customValues = Object.fromEntries(
      Object.entries(customFieldColumns).map(([label, get]) => [label, get(p)]),
    )
    if (hasFee) {
      return {
        ...base,
        // A ticketPaidAt with amount 0 is either the "Marquer gratuit" admin exemption
        // (src/app/api/evenements/[id]/participations/route.ts) or a genuine €0 tarif —
        // either way it isn't a real payment, so it must never render as "Payé" here.
        Paiement: p?.ticketPaidAt ? (Number(p.amount ?? 0) === 0 ? "Gratuit" : "Payé") : p?.rsvp === "CONFIRME" ? "Réservé" : "",
        RSVP:     "",
        ...(hasTicketTypes ? { Tarif: p?.ticketTypeId ? (ticketTypeLabels.get(p.ticketTypeId) ?? "") : "" } : {}),
        ...customValues,
      }
    }
    return { ...base, RSVP: p?.rsvp ? (RSVP_LABELS[p.rsvp] ?? "") : "", ...customValues }
  })

  if (fmt === "xlsx") {
    const ws = utils.json_to_sheet(rows)
    const wb = utils.book_new()
    utils.book_append_sheet(wb, ws, "Présences")

    // Fixed widths for the always-present columns (#, Nom, Prénom, Email, Téléphone,
    // Adresse, Présent, + Paiement/RSVP), then a generic width for however many custom
    // field columns this event happens to have — their count varies per event, so an
    // exact hardcoded array (like before) would silently mis-align as soon as it did.
    const fixedCols = hasFee
      ? [
          { wch: 4 }, { wch: 20 }, { wch: 20 }, { wch: 28 }, { wch: 16 }, { wch: 28 }, { wch: 10 }, { wch: 14 }, { wch: 14 },
          ...(hasTicketTypes ? [{ wch: 18 }] : []),
        ]
      : [{ wch: 4 }, { wch: 20 }, { wch: 20 }, { wch: 28 }, { wch: 16 }, { wch: 28 }, { wch: 10 }, { wch: 14 }]
    ws["!cols"] = [...fixedCols, ...evenement.customFields.map(() => ({ wch: 20 }))]

    const buf = write(wb, { type: "buffer", bookType: "xlsx" })
    return new NextResponse(buf, {
      headers: {
        "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="presences_${date}_${slug}.xlsx"`,
      },
    })
  }

  const header = Object.keys(rows[0] ?? { "#": "", Nom: "", Prénom: "", Email: "", Téléphone: "", Adresse: "", Présent: "", RSVP: "" }).join(",") + "\n"
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
