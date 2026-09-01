import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { withAdminAuth } from "@/lib/api-wrapper"

const FINANCE = ["ADMIN", "PRESIDENT", "TRESORIER"]

const tierSchema = z.object({
  id:           z.string().optional(), // absent = nouveau tier
  order:        z.number().int().min(0),
  itemType:     z.enum(["MEMBERSHIP", "ADDON", "DONATION"]).optional().default("MEMBERSHIP"),
  kind:         z.enum(["ONE_OFF", "RECURRING"]).optional().default("ONE_OFF"),
  free:         z.boolean().optional().default(false),
  freeAmount:   z.boolean().optional().default(false),
  amount:       z.number().positive().max(100000).nullable().optional(),
  // null = comportement historique (année civile). Borné à 5 ans — au-delà, un tarif ONE_OFF
  // ordinaire sans durationMonths a plus de sens qu'une "durée custom" démesurée.
  durationMonths: z.number().int().min(1).max(60).nullable().optional(),
  // Alternative à durationMonths — une date de fin absolue, identique pour tout signataire
  // peu importe quand il paie (ex. saison sportive). ISO string côté payload.
  fixedPeriodEnd: z.string().datetime().nullable().optional(),
  receiptMode:      z.enum(["NONE", "FULL", "PARTIAL"]).optional().default("NONE"),
  deductibleAmount: z.number().positive().max(100000).nullable().optional(),
  // "Payer en plusieurs fois" — voir schema.prisma. installmentsCount borné à [2, 12] : 1 fois
  // n'est pas "plusieurs", et au-delà de 12 mensualités automatiques Stripe le découpage
  // devient peu réaliste pour une cotisation associative.
  installmentsAllowed: z.boolean().optional().default(false),
  installmentsCount:   z.number().int().min(2).max(12).nullable().optional(),
  label:        z.string().trim().min(1).max(100),
  membreTypeId: z.string().nullable().optional(),
}).refine(d => !(d.free && d.freeAmount), {
  message: "Un tarif ne peut pas être à la fois gratuit et à montant libre", path: ["free"],
}).refine(d => d.free || d.freeAmount || d.amount != null, {
  message: "Un montant est requis pour un tarif à montant fixe", path: ["amount"],
}).refine(d => d.itemType !== "ADDON" || !d.free, {
  // A "free" add-on has no real meaning here (it wouldn't add anything to the total) —
  // if staff want a promotional no-cost extra, "montant libre" starting at 0 already covers
  // it without a dedicated toggle.
  message: "Une option ne peut pas être gratuite — utilisez un montant libre si besoin", path: ["free"],
}).refine(d => d.itemType !== "DONATION" || (d.freeAmount && !d.free), {
  message: "Une donation est toujours à montant libre", path: ["freeAmount"],
}).refine(d => d.itemType !== "DONATION" || d.amount != null, {
  message: "Un montant minimum est requis pour une donation", path: ["amount"],
}).refine(d => d.kind !== "RECURRING" || !d.durationMonths || d.durationMonths <= 12, {
  // Stripe's recurring price interval_count caps at 12 for a "month" interval (and at 1 for
  // "year") — there's no way to express e.g. "billed every 18 months" as a single Price, so
  // a RECURRING tier's custom duration can't exceed what checkout/route.ts can actually build.
  message: "Un tarif récurrent est limité à une durée de 12 mois maximum", path: ["durationMonths"],
}).refine(d => !(d.durationMonths && d.fixedPeriodEnd), {
  message: "Choisissez une durée en mois ou une date de fin fixe, pas les deux", path: ["fixedPeriodEnd"],
}).refine(d => d.kind !== "RECURRING" || !d.fixedPeriodEnd, {
  // A RECURRING tier renews indefinitely — an absolute end date doesn't fit the Stripe
  // Subscription model it bills through (see checkout/route.ts).
  message: "Une date de fin fixe n'est pas disponible pour un tarif récurrent", path: ["fixedPeriodEnd"],
}).refine(d => !d.free || d.receiptMode === "NONE", {
  // No money changes hands on a free tier — nothing to issue a tax-deductible receipt for.
  message: "Un tarif gratuit ne peut pas être éligible au reçu fiscal", path: ["receiptMode"],
}).refine(d => d.receiptMode !== "PARTIAL" || !d.freeAmount, {
  // Le montant déductible est une valeur fixe attachée au tarif — n'a pas de sens pour un
  // tarif à montant libre où l'adhérent choisit lui-même le montant versé.
  message: "Le reçu partiel n'est pas disponible pour un montant libre", path: ["receiptMode"],
}).refine(d => d.receiptMode !== "PARTIAL" || d.deductibleAmount != null, {
  message: "Le montant déductible est requis pour un reçu partiel", path: ["deductibleAmount"],
}).refine(d => d.receiptMode !== "PARTIAL" || d.amount == null || d.deductibleAmount == null || d.deductibleAmount <= d.amount, {
  message: "Le montant déductible ne peut pas dépasser le montant du tarif", path: ["deductibleAmount"],
}).refine(d => !d.installmentsAllowed || (d.kind === "ONE_OFF" && !d.free && !d.freeAmount), {
  // RECURRING is already spread over time by nature; free has nothing to split; freeAmount
  // has no fixed total to divide into N equal installments up front.
  message: "Le paiement en plusieurs fois n'est disponible que pour un tarif ponctuel à montant fixe", path: ["installmentsAllowed"],
}).refine(d => !d.installmentsAllowed || d.installmentsCount != null, {
  message: "Le nombre de fois est requis", path: ["installmentsCount"],
}).refine(d => !d.installmentsAllowed || !d.installmentsCount || !d.amount || d.amount / d.installmentsCount >= 1, {
  // Stripe refuses to charge below ~0.50€ — 1€/mensualité gives headroom above that floor
  // rather than sitting right on it. checkout/route.ts's Math.ceil rounding means the actual
  // per-cycle charge is always >= this, never below.
  message: "Chaque mensualité doit être d'au moins 1€ — augmentez le montant ou réduisez le nombre de fois", path: ["installmentsCount"],
})

const tiersSchema = z.array(tierSchema).max(20)

export const GET = withAdminAuth<{ id: string }>(async (_req, ctx, { id }) => {
  if (!FINANCE.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const form = await prisma.membershipForm.findFirst({ where: { id, associationId: ctx.associationId }, select: { id: true } })
  if (!form) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const tiers = await prisma.membershipTier.findMany({ where: { formId: id }, orderBy: { order: "asc" } })
  return NextResponse.json(tiers)
}, { module: "cotisations" })

export const PUT = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  if (!FINANCE.includes(ctx.role))
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  const form = await prisma.membershipForm.findFirst({ where: { id, associationId: ctx.associationId } })
  if (!form) return NextResponse.json({ error: "Introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = tiersSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  // Un formulaire sans aucun tarif MEMBERSHIP n'a plus rien à vendre — la page publique
  // resterait bloquée sur "aucun tarif disponible" même si des options/donations restent
  // configurées. Le client bloque déjà ce cas (voir membershipTierRequiredError), mais un
  // appel direct à l'API ne doit pas pouvoir le contourner.
  if (!parsed.data.some(t => t.itemType === "MEMBERSHIP"))
    return NextResponse.json({ error: "Le formulaire doit avoir au moins un tarif d'adhésion." }, { status: 422 })

  // Un tarif déjà utilisé (par une Cotisation, un abonnement, un achat d'option ou une
  // donation embarquée) ne doit ni changer de itemType — ça réécrirait silencieusement son
  // sens historique, et la normalisation plus bas effacerait des champs (kind/membreTypeId)
  // que ces lignes passées référencent encore — ni être supprimé : MembershipAddonPurchase.
  // tier est en onDelete: Cascade (son tierId est obligatoire, contrairement à celui de
  // Cotisation), donc supprimer une tier ADDON déjà achetée détruirait tout son historique
  // d'achat. Les deux cas sont bloqués ici, avant toute écriture.
  const existingTiersForTypeCheck = await prisma.membershipTier.findMany({
    where:  { formId: id },
    select: { id: true, itemType: true, label: true },
  })
  const existingTierById = new Map(existingTiersForTypeCheck.map(t => [t.id, t]))
  const incomingIdsForCheck = new Set(parsed.data.filter(t => t.id).map(t => t.id))

  async function tierUsageCount(tierId: string): Promise<number> {
    // Don.tierId pointe vers DonationTier (un modèle sans rapport) — une donation embarquée
    // via un MembershipForm n'en a jamais et laisse toujours ce champ à null ; c'est
    // membershipAddonTierId qui porte le lien vers ce MembershipTier-ci (voir schema.prisma).
    const [cotisationCount, subscriptionCount, addonCount, donCount] = await Promise.all([
      prisma.cotisation.count({ where: { tierId } }),
      prisma.cotisationSubscription.count({ where: { tierId } }),
      prisma.membershipAddonPurchase.count({ where: { tierId } }),
      prisma.don.count({ where: { membershipAddonTierId: tierId } }),
    ])
    return cotisationCount + subscriptionCount + addonCount + donCount
  }

  for (const t of parsed.data) {
    if (!t.id) continue
    const prev = existingTierById.get(t.id)
    if (!prev || prev.itemType === t.itemType) continue
    if (await tierUsageCount(t.id) > 0) {
      return NextResponse.json({
        error: `Le tarif « ${prev.label} » a déjà des adhésions ou achats liés — son type ne peut plus être modifié.`,
      }, { status: 422 })
    }
  }

  for (const prev of existingTiersForTypeCheck) {
    if (incomingIdsForCheck.has(prev.id)) continue // toujours présent, pas une suppression
    if (await tierUsageCount(prev.id) > 0) {
      return NextResponse.json({
        error: `Le tarif « ${prev.label} » a déjà des adhésions ou achats liés — il ne peut plus être supprimé.`,
      }, { status: 422 })
    }
  }

  const wantedTypeIds = [...new Set(parsed.data.map(t => t.membreTypeId).filter((v): v is string => !!v))]
  if (wantedTypeIds.length) {
    const validTypes = await prisma.membreType.findMany({
      where:  { id: { in: wantedTypeIds }, associationId: ctx.associationId },
      select: { id: true },
    })
    if (validTypes.length !== wantedTypeIds.length)
      return NextResponse.json({ error: "Type de membre invalide." }, { status: 422 })
  }

  const tiers = await prisma.$transaction(async tx => {
    // Même convention d'upsert-par-id que DonationTier — préserve les Cotisation.tierId déjà
    // émis plutôt que de tout recréer.
    const existing    = await tx.membershipTier.findMany({ where: { formId: id }, select: { id: true } })
    const existingIds = new Set(existing.map(t => t.id))
    const incomingIds = new Set(parsed.data.filter(t => t.id).map(t => t.id))

    const toDelete = [...existingIds].filter(tid => !incomingIds.has(tid))
    if (toDelete.length) {
      await tx.membershipTier.deleteMany({ where: { id: { in: toDelete } } })
    }

    for (const t of parsed.data) {
      // itemType governs a few fields the client-side editor already disables, but never
      // trust that alone — normalize server-side too so a stale/tampered payload can't leave
      // e.g. a recurring ADDON or a membre-type-tagging DONATION in the database.
      const isMembership = t.itemType === "MEMBERSHIP"
      // Une donation reste éligible au reçu fiscal, comme sur AssoConnect ("Reçus fiscaux" sur
      // sa formule de type Dons) — seule une option (ADDON) n'a jamais de sens fiscalement.
      const receiptEligible = t.itemType !== "ADDON"
      const data = {
        order:        t.order,
        itemType:     t.itemType,
        kind:         isMembership ? t.kind : "ONE_OFF" as const,
        free:         t.itemType === "DONATION" ? false : t.free,
        freeAmount:   t.itemType === "DONATION" ? true : (t.free ? false : t.freeAmount),
        amount:       t.free || (t.itemType !== "DONATION" && t.freeAmount) ? null : t.amount,
        durationMonths: isMembership ? (t.durationMonths || null) : null,
        fixedPeriodEnd: isMembership && t.fixedPeriodEnd ? new Date(t.fixedPeriodEnd) : null,
        receiptMode:      receiptEligible && !t.free ? t.receiptMode : "NONE" as const,
        deductibleAmount: isMembership && !t.free && t.receiptMode === "PARTIAL" ? t.deductibleAmount : null,
        installmentsAllowed: isMembership && t.kind === "ONE_OFF" && !t.free && !t.freeAmount ? !!t.installmentsAllowed : false,
        installmentsCount:   isMembership && t.kind === "ONE_OFF" && !t.free && !t.freeAmount && t.installmentsAllowed ? t.installmentsCount : null,
        label:        t.label,
        membreTypeId: isMembership ? (t.membreTypeId || null) : null,
      }
      if (t.id && existingIds.has(t.id)) {
        await tx.membershipTier.update({ where: { id: t.id }, data })
      } else {
        await tx.membershipTier.create({ data: { ...data, formId: id } })
      }
    }

    return tx.membershipTier.findMany({ where: { formId: id }, orderBy: { order: "asc" } })
  })

  return NextResponse.json(tiers)
}, { module: "cotisations" })
