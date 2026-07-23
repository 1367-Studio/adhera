import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"

// A plain `ORDER BY number DESC` on the zero-padded string breaks once the sequence
// exceeds 4 digits within a year: "DEV-2026-10000" sorts *before* "DEV-2026-9999"
// lexicographically ('1' < '9'), so `findFirst` would keep returning 9999 as "last"
// forever past that point, and every subsequent create would collide with the existing
// 10000 and exhaust its retry budget. Casting the numeric suffix for the ORDER BY avoids
// that. `table` is always one of the two literals below, never user input, so building
// the identifier with Prisma.raw here is safe.
//
// The `::int` cast on the bound parameter is load-bearing, not decorative: an untyped
// placeholder in `substring(text FROM $n)` makes Postgres resolve the *regex* overload
// (`substring(text FROM pattern)`) instead of the positional one, silently turning the
// offset into a literal pattern to search for — verified live against dev/stage, where
// dropping the cast made "...-9999" (no literal "10" inside it) resolve to NULL and
// "...-10000" (which contains "10") resolve to 10 instead of 10000.
async function nextNumber(
  yearPrefix: string,
  table: "Devis" | "Facture" | "BoutiqueCommande" | "Cotisation",
  column: "number" | "receiptNumber" | "declarationNumber",
  associationId: string,
): Promise<string> {
  const col = Prisma.raw(`"${column}"`)

  const rows = await prisma.$queryRaw<{ value: string }[]>(Prisma.sql`
    SELECT ${col} AS value FROM ${Prisma.raw(`"${table}"`)}
    WHERE "associationId" = ${associationId} AND ${col} LIKE ${`${yearPrefix}%`}
    ORDER BY (substring(${col} FROM ${yearPrefix.length + 1}::int))::int DESC
    LIMIT 1
  `)

  let seq = 1
  const last = rows[0]?.value
  if (last) {
    const num = parseInt(last.slice(yearPrefix.length), 10)
    seq = num + 1
  }
  return `${yearPrefix}${String(seq).padStart(4, "0")}`
}

export function nextDevisNumber(associationId: string): Promise<string> {
  const year = new Date().getFullYear()
  return nextNumber(`DEV-${year}-`, "Devis", "number", associationId)
}

export function nextFactureNumber(associationId: string): Promise<string> {
  const year = new Date().getFullYear()
  return nextNumber(`FAC-${year}-`, "Facture", "number", associationId)
}

export function nextBoutiqueReceiptNumber(associationId: string): Promise<string> {
  const year = new Date().getFullYear()
  return nextNumber(`REC-${year}-`, "BoutiqueCommande", "receiptNumber", associationId)
}

export function nextCotisationDeclarationNumber(associationId: string): Promise<string> {
  const year = new Date().getFullYear()
  return nextNumber(`${year}-`, "Cotisation", "declarationNumber", associationId)
}
