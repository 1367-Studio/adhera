import { NextResponse } from "next/server"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { isMembreAdherent, membreAdherentCotisationSelect, membreAdherentResponsableSelect } from "@/lib/membre-adherent"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

// Cutoff used to bucket "adulte"/"enfant" from birthDate — Prisma can't groupBy a computed
// age, so members with a known birthDate are fetched and bucketed here instead.
const ADULT_AGE_YEARS = 18

function emptyBucket() {
  return { count: 0, hommes: 0, femmes: 0, sexeNonRenseigne: 0, adultes: 0, enfants: 0, ageNonRenseigne: 0 }
}

export const GET = withAdminAuth(async (_req, ctx) => {
  const { associationId } = ctx

  const membres = await prisma.membre.findMany({
    where:  { associationId, deletedAt: null },
    select: {
      sexe: true, birthDate: true, adherentOverride: true,
      cotisations: membreAdherentCotisationSelect(),
      responsable: membreAdherentResponsableSelect(),
    },
  })

  const adultCutoff = new Date()
  adultCutoff.setFullYear(adultCutoff.getFullYear() - ADULT_AGE_YEARS)

  const total = emptyBucket()
  const adherents = emptyBucket()
  const benevoles = emptyBucket()

  for (const m of membres) {
    const bucket = isMembreAdherent(m) ? adherents : benevoles
    for (const b of [total, bucket]) {
      b.count++
      if (m.sexe === "HOMME") b.hommes++
      else if (m.sexe === "FEMME") b.femmes++
      else b.sexeNonRenseigne++
      if (!m.birthDate) b.ageNonRenseigne++
      else if (m.birthDate <= adultCutoff) b.adultes++
      else b.enfants++
    }
  }

  return NextResponse.json({ ...total, adherents, benevoles })
}, { roles: MANAGERS })
