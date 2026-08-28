import { NextResponse } from "next/server"
import { randomUUID } from "crypto"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"
import { importMembreRowSchema, type ImportMembreRow } from "@/lib/schemas"
import { assertMemberLimit, MemberLimitReachedError } from "@/lib/plan-limits"
import { isPlaceholderEmail, normalizeName } from "@/lib/membre-import-matching"
import { inngest } from "@/lib/inngest"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, userId } = ctx

  const body = await req.json()
  const { rows, inviteToPortal } = body as { rows: unknown[]; inviteToPortal?: boolean }
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "Aucune ligne à importer" }, { status: 422 })
  }

  const parsedRows: ImportMembreRow[] = []
  let schemaErrors = 0
  for (const raw of rows) {
    const parsed = importMembreRowSchema.safeParse(raw)
    if (parsed.success) parsedRows.push(parsed.data)
    else schemaErrors++
  }
  if (parsedRows.length === 0) {
    return NextResponse.json({ error: "Aucune ligne valide à importer" }, { status: 422 })
  }

  // Upper bound on new ACTIF members this import could create, simulating the same matching
  // rules the background job (src/inngest/membres-import.ts) will actually run (externalId
  // first, then email+name, placeholders and bare emails never match) — checked synchronously
  // here so a plan-limit rejection happens before an Inngest run is even queued, not after.
  const externalIds = [...new Set(parsedRows.map(r => r.externalId).filter((v): v is string => !!v))]
  const emails = [...new Set(
    parsedRows.map(r => r.email?.trim().toLowerCase()).filter((e): e is string => !!e && !isPlaceholderEmail(e)),
  )]
  const existingMembres = (externalIds.length > 0 || emails.length > 0)
    ? await prisma.membre.findMany({
        where: {
          associationId, deletedAt: null,
          OR: [
            ...(externalIds.length > 0 ? [{ externalId: { in: externalIds } }] : []),
            ...(emails.length > 0 ? [{ email: { in: emails, mode: "insensitive" as const } }] : []),
          ],
        },
        select: { externalId: true, email: true, firstName: true, lastName: true },
      })
    : []
  const existingExternalIds = new Set(existingMembres.map(m => m.externalId).filter((v): v is string => !!v))
  const existingEmailNameKeys = new Set(
    existingMembres.filter(m => m.email).map(m => `${m.email!.toLowerCase()}|${normalizeName(m.firstName)}|${normalizeName(m.lastName)}`),
  )

  // Mirrors the background job's cascade exactly: externalId is tried first, but a row can
  // still match an existing Membre by email+name even when it has an externalId, if that
  // existing record predates externalId being backfilled onto it.
  let estimatedNew = 0
  const seenExternalIds   = new Set<string>()
  const seenEmailNameKeys = new Set<string>()
  for (const row of parsedRows) {
    const matchesExternalId = !!row.externalId && (existingExternalIds.has(row.externalId) || seenExternalIds.has(row.externalId))
    const emailNameKey = row.email && !isPlaceholderEmail(row.email)
      ? `${row.email.trim().toLowerCase()}|${normalizeName(row.firstName)}|${normalizeName(row.lastName)}`
      : null
    const matchesEmailName = !!emailNameKey && (existingEmailNameKeys.has(emailNameKey) || seenEmailNameKeys.has(emailNameKey))

    if (row.externalId) seenExternalIds.add(row.externalId)
    if (emailNameKey) seenEmailNameKeys.add(emailNameKey)

    if (!matchesExternalId && !matchesEmailName) estimatedNew++
  }

  try {
    await assertMemberLimit(associationId, estimatedNew)
  } catch (err) {
    if (err instanceof MemberLimitReachedError) return NextResponse.json({ error: err.message, code: err.code }, { status: 422 })
    throw err
  }

  const jobId = randomUUID()

  await inngest.send({
    name: "bulk/membres-import.requested",
    data: {
      jobId,
      associationId,
      actorId: userId,
      rows:    parsedRows,
      inviteToPortal: inviteToPortal === true,
    },
  })

  return NextResponse.json({ jobId, totalRows: parsedRows.length, schemaErrors })
}, { roles: MANAGERS })
