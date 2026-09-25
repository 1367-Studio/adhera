import { prisma } from "@/lib/prisma/client"

// Membre has no direct column pointing at the MembershipForm used at signup — Membre.answers
// is only ever captured once, at signup (see schema.prisma), so the closest thing is the
// earliest Cotisation carrying a non-null membershipFormId. Returns null for a member created
// outside any MembershipForm (manual creation by an admin, or the legacy /inscription flow) —
// callers must treat that as "no custom fields to edit", not an error.
export async function resolveMembreMembershipFormId(membreId: string): Promise<string | null> {
  const cotisation = await prisma.cotisation.findFirst({
    where:   { membreId, membershipFormId: { not: null } },
    orderBy: { year: "asc" },
    select:  { membershipFormId: true },
  })
  if (cotisation?.membershipFormId) return cotisation.membershipFormId

  // A member still PENDING on a "validation sur demande" free-tier signup has no Cotisation
  // at all yet — checkout/route.ts only creates one once an admin approves (see PATCH
  // /api/membres/[id]'s isApproval branch) — even though Membre.answers was already captured
  // against the real form at signup. Membre.pendingTierId (cleared on approval) is the only
  // other place that form is still reachable from until then.
  const membre = await prisma.membre.findUnique({
    where:  { id: membreId },
    select: { pendingTier: { select: { formId: true } } },
  })
  return membre?.pendingTier?.formId ?? null
}
