import { prisma } from "@/lib/prisma/client"
import { normalizeName } from "@/lib/membre-import-matching"

// A public signup can't be told "someone with your name is already a member" — the form is
// open to anyone holding the link, so answering that would turn it into a queryable directory
// of the association's membership. The match therefore runs here, after the fact, and is
// reported to the staff only (see notifyMembershipSignup). The visitor is never told, and
// nothing is blocked or merged automatically: same name is a strong hint, not proof.
export type DuplicateReason = "name" | "phone"

export type PossibleDuplicate = {
  membreId:   string // the member just created
  membreName: string
  existingId: string // the older member it resembles
  reason:     DuplicateReason
}

// Phone numbers are free text on Membre — "06 12 34 56 78", "+33612345678" and "0612345678"
// are the same line. Comparing the last 9 digits folds the country prefix and the trunk zero
// without needing a parsing library. Below 9 digits there isn't enough to identify anyone
// (an extension, a truncated entry), so those never match.
const PHONE_SIGNIFICANT_DIGITS = 9

export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "")
  return digits.length >= PHONE_SIGNIFICANT_DIGITS ? digits.slice(-PHONE_SIGNIFICANT_DIGITS) : null
}

// Looks for existing members that the freshly created ones resemble. Deliberately narrow:
// only an exact (accent- and case-insensitive) first+last name match, or the same phone line.
// A shared household email is explicitly NOT a signal on its own — a parent and a minor child
// legitimately share one, which is the same reasoning the import's own matching applies.
export async function findPossibleDuplicates(
  associationId: string,
  membreIds: string[],
): Promise<PossibleDuplicate[]> {
  if (membreIds.length === 0) return []

  const created = await prisma.membre.findMany({
    where:  { id: { in: membreIds }, associationId, deletedAt: null },
    select: { id: true, firstName: true, lastName: true, phone: true },
  })
  if (created.length === 0) return []

  // One pass over the association's members rather than a query per new member: a signup
  // creates at most MAX_REGISTRANTS (10) rows, and the comparison can't be pushed into SQL
  // anyway — Postgres's case-insensitive mode folds case but not accents (see normalizeName),
  // and phoneKey has no SQL equivalent.
  const others = await prisma.membre.findMany({
    where:  { associationId, deletedAt: null, id: { notIn: membreIds } },
    select: { id: true, firstName: true, lastName: true, phone: true },
  })

  const byName  = new Map<string, string>()
  const byPhone = new Map<string, string>()
  for (const m of others) {
    const nameKey = `${normalizeName(m.firstName)}|${normalizeName(m.lastName)}`
    if (!byName.has(nameKey)) byName.set(nameKey, m.id)
    const pk = phoneKey(m.phone)
    if (pk && !byPhone.has(pk)) byPhone.set(pk, m.id)
  }

  const found: PossibleDuplicate[] = []
  for (const m of created) {
    const membreName = `${m.firstName} ${m.lastName}`
    const nameMatch = byName.get(`${normalizeName(m.firstName)}|${normalizeName(m.lastName)}`)
    if (nameMatch) {
      found.push({ membreId: m.id, membreName, existingId: nameMatch, reason: "name" })
      continue // one flag per new member is enough to get a human to look
    }
    const pk = phoneKey(m.phone)
    const phoneMatch = pk ? byPhone.get(pk) : undefined
    if (phoneMatch) found.push({ membreId: m.id, membreName, existingId: phoneMatch, reason: "phone" })
  }
  return found
}
