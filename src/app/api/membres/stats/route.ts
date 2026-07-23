import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

// Cutoff used to bucket "adulte"/"enfant" from birthDate — Prisma can't groupBy a computed
// age, so members with a known birthDate are fetched and bucketed here instead.
const ADULT_AGE_YEARS = 18

export const GET = withAdminAuth(async (_req, ctx) => {
  const { associationId } = ctx

  const [sexeGroups, birthDates] = await Promise.all([
    prisma.membre.groupBy({
      by:     ["sexe"],
      where:  { associationId, deletedAt: null },
      _count: true,
    }),
    prisma.membre.findMany({
      where:  { associationId, deletedAt: null },
      select: { birthDate: true },
    }),
  ])

  const hommes           = sexeGroups.find(g => g.sexe === "HOMME")?._count ?? 0
  const femmes           = sexeGroups.find(g => g.sexe === "FEMME")?._count ?? 0
  const sexeNonRenseigne = sexeGroups.find(g => g.sexe === null)?._count ?? 0

  const adultCutoff = new Date()
  adultCutoff.setFullYear(adultCutoff.getFullYear() - ADULT_AGE_YEARS)

  let adultes = 0
  let enfants = 0
  let ageNonRenseigne = 0
  for (const { birthDate } of birthDates) {
    if (!birthDate) { ageNonRenseigne++; continue }
    if (birthDate <= adultCutoff) adultes++
    else enfants++
  }

  return NextResponse.json({ hommes, femmes, sexeNonRenseigne, adultes, enfants, ageNonRenseigne })
}, { roles: MANAGERS })
