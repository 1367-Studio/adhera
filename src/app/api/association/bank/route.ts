import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"

// Same role set as the rest of finances/* — the treasurer owns this data day-to-day and
// shouldn't need the president/admin to relay every IBAN change (unlike name/city/country,
// which stay behind the general ADMINS-only Paramètres form).
const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

// Loose but real format checks — not a full mod-97 IBAN checksum, but enough to catch a
// mistyped/pasted-wrong value before it ends up printed on every devis/facture PDF and a
// client tries to wire money against it.
const IBAN_REGEX = /^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/
const BIC_REGEX  = /^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/

const schema = z.object({
  website: z.string().trim()
    .transform(v => (v === "" || /^https?:\/\//i.test(v)) ? v : `https://${v}`)
    .pipe(z.union([z.literal(""), z.string().url("Site web invalide").max(300)])),
  iban: z.string().trim()
    .transform(v => v.replace(/\s+/g, "").toUpperCase())
    .pipe(z.union([z.literal(""), z.string().regex(IBAN_REGEX, "IBAN invalide")])),
  bic: z.string().trim()
    .transform(v => v.replace(/\s+/g, "").toUpperCase())
    .pipe(z.union([z.literal(""), z.string().regex(BIC_REGEX, "BIC invalide")])),
})

export const PATCH = withAdminAuth(async (req, ctx) => {
  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const { website, iban, bic } = parsed.data
  const association = await prisma.association.update({
    where: { id: ctx.associationId },
    data:  { website: website || null, iban: iban || null, bic: bic || null },
  })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "ASSOCIATION_UPDATED",
    entity:        "Association",
    label:         "Coordonnées bancaires",
  })

  return NextResponse.json({ website: association.website, iban: association.iban, bic: association.bic })
}, { roles: FINANCE })
