import { prisma } from "@/lib/prisma/client"

/** The identity fields every portal card surface needs — never a Prisma row. */
export type PortalHouseholdMember = {
  id:        string
  firstName: string
  lastName:  string
}

/**
 * The people a logged-in member may see a card for: themselves, and anyone they are the
 * responsable of. The portal had never exposed a dependant before the member card, so this
 * rule lives here and only here — the list route (GET /api/portal/carte) and the PDF route
 * (GET /api/portal/carte/pdf) both derive their answer from this one query, which is what
 * stops a member from addressing someone else by sending a membreId the list would never
 * have shown them.
 *
 * Derived from the session's own Membre alone (`id = accountHolder` or
 * `responsableId = accountHolder`), always inside associationId, so no caller can widen it.
 *
 * Ordered account holder first — it is their own card they came for — then the dependants
 * alphabetically, so the switcher keeps the same order between two visits (and between two
 * people looking at the same household), and so `[0]` is always the account holder.
 */
export async function loadPortalHousehold(
  associationId: string,
  accountHolderId: string,
): Promise<PortalHouseholdMember[]> {
  const household = await prisma.membre.findMany({
    where: {
      associationId,
      deletedAt: null,
      OR: [{ id: accountHolderId }, { responsableId: accountHolderId }],
    },
    select:  { id: true, firstName: true, lastName: true },
    orderBy: { firstName: "asc" },
  })

  return [
    ...household.filter(member => member.id === accountHolderId),
    ...household.filter(member => member.id !== accountHolderId),
  ]
}
