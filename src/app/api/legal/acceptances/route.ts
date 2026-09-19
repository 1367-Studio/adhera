import { withAdminAuth } from "@/lib/api-wrapper"
import { NextResponse } from "next/server"
import { prisma } from "@/lib/prisma/client"
import { MANAGER_ROLES } from "@/lib/roles"

// Proof of consent, as a CSV a manager can hand to whoever asks — an auditor, an insurer, a
// judge. Evidence nobody can read is not evidence, which is the whole reason this endpoint
// exists rather than leaving the rows in the database.
//
// One row per person per document version, newest first. `?documentId=` narrows it to a single
// document; without it the export covers every document of the association.

const CSV_HEADERS = [
  "Date", "Document", "Version", "Nom", "Email", "Parcours", "Adresse IP", "Attesté par",
] as const

// Guards against CSV injection: a cell opening with =, +, - or @ is executed as a formula by
// Excel and Google Sheets, and these cells hold names and emails people chose themselves.
function csvCell(value: string | null | undefined): string {
  const text = (value ?? "").replace(/"/g, '""')
  const needsGuard = /^[=+\-@\t\r]/.test(text)
  return `"${needsGuard ? `'${text}` : text}"`
}

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx
  const documentId = new URL(req.url).searchParams.get("documentId")

  const acceptances = await prisma.legalAcceptance.findMany({
    where: {
      associationId,
      ...(documentId ? { revision: { documentId } } : {}),
    },
    orderBy: { acceptedAt: "desc" },
    select: {
      acceptedAt: true, context: true, ip: true, guestEmail: true,
      membreId:   true, collectedById: true,
      revision:   { select: { version: true, title: true } },
    },
  })

  // membreId/collectedById are plain columns, not relations (a deleted member must not shred
  // the proof they once agreed), so the names are resolved in one extra query each rather than
  // through an include — and never one query per row.
  const membreIds = [...new Set(acceptances.flatMap(acceptance => acceptance.membreId ? [acceptance.membreId] : []))]
  const membres = membreIds.length > 0
    ? await prisma.membre.findMany({ where: { id: { in: membreIds } }, select: { id: true, firstName: true, lastName: true, email: true } })
    : []
  const membreById = new Map(membres.map(membre => [membre.id, membre]))

  const collectorIds = [...new Set(acceptances.flatMap(a => a.collectedById ? [a.collectedById] : []))]
  const collectors = collectorIds.length > 0
    ? await prisma.user.findMany({ where: { id: { in: collectorIds } }, select: { id: true, name: true, email: true } })
    : []
  const collectorById = new Map(collectors.map(collector => [collector.id, collector]))

  const rows = acceptances.map(acceptance => {
    const membreId = (acceptance as { membreId?: string | null }).membreId ?? null
    const membre   = membreId ? membreById.get(membreId) : undefined
    const collector = acceptance.collectedById ? collectorById.get(acceptance.collectedById) : undefined
    return [
      acceptance.acceptedAt.toISOString(),
      acceptance.revision.title,
      String(acceptance.revision.version),
      membre ? `${membre.firstName} ${membre.lastName}` : "",
      acceptance.guestEmail ?? membre?.email ?? "",
      acceptance.context,
      acceptance.ip ?? "",
      collector ? (collector.name ?? collector.email) : "",
    ].map(csvCell).join(",")
  })

  // BOM so Excel opens accented names as UTF-8 instead of mojibake.
  const csv = `﻿${CSV_HEADERS.map(csvCell).join(",")}\n${rows.join("\n")}\n`

  return new NextResponse(csv, {
    headers: {
      "Content-Type":        "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="acceptations-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  })
}, { roles: MANAGER_ROLES })
