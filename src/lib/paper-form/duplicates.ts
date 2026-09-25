import { prisma } from "@/lib/prisma/client"
import { isPlaceholderEmail, normalizeName } from "@/lib/membre-import-matching"
import {
  PAPER_FORM_DUPLICATE_MAX_MATCHES,
  type PaperFormDuplicateMatch,
  type PaperFormDuplicatePerson,
} from "@/lib/schemas"

function nameKey(firstName: string, lastName: string): string {
  return `${normalizeName(firstName)}|${normalizeName(lastName)}`
}

// The existing members a scanned person may already be: same email (case-insensitive, never
// AssoConnect's bounce placeholder — see isPlaceholderEmail) or same first + last name
// (accent-insensitive — see normalizeName). A hint for the review screen, never an automatic
// merge: two real people can share a household email or a name.
//
// Names are compared in JS, not in the WHERE: Postgres's insensitive mode folds case but not
// accents, so "Jose" would miss "José". That means reading every live member's name once —
// a handful of short columns, bounded by the plan's member limit — instead of one query per
// scanned person.
export async function findPaperFormDuplicates(
  associationId: string,
  people: PaperFormDuplicatePerson[],
): Promise<Record<string, PaperFormDuplicateMatch[]>> {
  const existingMembres = await prisma.membre.findMany({
    where:   { associationId, deletedAt: null },
    select:  { id: true, firstName: true, lastName: true, email: true, phone: true, status: true },
    orderBy: { createdAt: "asc" },
  })

  const membresByEmail = new Map<string, PaperFormDuplicateMatch[]>()
  const membresByName  = new Map<string, PaperFormDuplicateMatch[]>()
  for (const membre of existingMembres) {
    const email = membre.email?.trim().toLowerCase()
    if (email && !isPlaceholderEmail(email)) {
      membresByEmail.set(email, [...(membresByEmail.get(email) ?? []), membre])
    }
    const key = nameKey(membre.firstName, membre.lastName)
    membresByName.set(key, [...(membresByName.get(key) ?? []), membre])
  }

  const matches: Record<string, PaperFormDuplicateMatch[]> = {}
  for (const person of people) {
    const personEmail = person.email?.trim().toLowerCase()
    const emailMatches = personEmail && !isPlaceholderEmail(personEmail) ? membresByEmail.get(personEmail) ?? [] : []
    const hasName      = person.firstName.trim() !== "" && person.lastName.trim() !== ""
    const nameMatches  = hasName ? membresByName.get(nameKey(person.firstName, person.lastName)) ?? [] : []

    // Email matches first: the stronger signal. A member matching both is listed once.
    const personMatches = new Map<string, PaperFormDuplicateMatch>()
    for (const membre of [...emailMatches, ...nameMatches]) {
      if (personMatches.size >= PAPER_FORM_DUPLICATE_MAX_MATCHES) break
      personMatches.set(membre.id, membre)
    }
    if (personMatches.size > 0) {
      matches[person.ref] = [...personMatches.values()].map((membre) => ({
        id:        membre.id,
        firstName: membre.firstName,
        lastName:  membre.lastName,
        email:     membre.email,
        phone:     membre.phone,
        status:    membre.status,
      }))
    }
  }
  return matches
}
