import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { SPOKEN_LANGUAGE_CODES } from "@/lib/languages"
import { Prisma } from "@prisma/client"
import type Stripe from "stripe"
import { stripe, connectAccountChargesEnabled } from "@/lib/stripe"
import { prisma } from "@/lib/prisma/client"
import { parseModules } from "@/lib/modules"
import { APP_URL } from "@/lib/env"
import { rateLimit, requestIp } from "@/lib/rate-limit"
import { assertMemberLimit, MemberLimitReachedError, MEMBER_LIMIT_VISITOR_MESSAGE, resolveDocumentBranding } from "@/lib/plan-limits"
import { CURRENT_TERMS_VERSION, consentIp } from "@/lib/consent"
import { currentCotisationYear } from "@/lib/membre-adherent"
import { writeActivityLog } from "@/lib/activity-log"
import { sendEmail } from "@/lib/mail"
import { membershipWelcomeEmail, membershipPendingValidationEmail } from "@/lib/email"
import { fireEventRule } from "@/lib/fire-event-rule"
import { addMonths } from "date-fns"
import { consumeMembershipCheckoutDraft } from "@/lib/webhook/membership-multi"
import { notifyMembershipSignup } from "@/lib/webhook/membership-notify"
import { eligibleReceiptAmount } from "@/lib/receipt-eligibility"

// Mirrors the public form's own MIN_AMOUNT floor — the client already refuses to submit
// below this for any montant-libre option, this is just the server not trusting that alone.
const MIN_ITEM_AMOUNT = 1

// Bounds both Stripe's line_items array and how many rows a single submission can create —
// see handleMultiRegistrantCheckout below.
const MAX_REGISTRANTS = 10

type ResolvedAddon = {
  tierId:   string
  itemType: "ADDON" | "DONATION"
  label:    string
  amount:   number
  receiptMode:      "NONE" | "FULL" | "PARTIAL"
  deductibleAmount: number | null
}
type AddonTier = {
  id: string; itemType: string; label: string; freeAmount: boolean
  amount: Prisma.Decimal | null; receiptMode: "NONE" | "FULL" | "PARTIAL"
  ineligibleAmount: Prisma.Decimal | null
}

// Options (add-ons / don embarqué) — validées et re-tarifées server-side, jamais reprises
// telles quelles du payload, même raisonnement que le montant de la tarif principale. Partagé
// entre le parcours à un seul adhérent et l'inscription groupée : deux copies de ce barème
// auraient fini par diverger, et c'est du code qui décide de ce qui est facturé.
function resolveAddons(
  tiers: AddonTier[],
  requested: { tierId: string; amount?: number }[],
): { ok: true; addons: ResolvedAddon[] } | { ok: false; error: string } {
  if (new Set(requested.map(a => a.tierId)).size !== requested.length)
    return { ok: false, error: "Options en double" }

  const addons: ResolvedAddon[] = []
  for (const a of requested) {
    const addonTier = tiers.find(t => t.id === a.tierId && t.itemType !== "MEMBERSHIP")
    if (!addonTier) return { ok: false, error: "Option invalide" }
    const itemAmount = addonTier.freeAmount ? a.amount : Number(addonTier.amount)
    if (!itemAmount || itemAmount <= 0)
      return { ok: false, error: `Montant invalide pour « ${addonTier.label} »` }
    // Un ADDON à montant libre sans minimum configuré (addonTier.amount == null) retombe sur
    // le même plancher que le formulaire applique déjà au total (MIN_AMOUNT côté client) —
    // sans ça, rien n'empêchait un centime symbolique.
    const itemMinimum = addonTier.amount != null ? Number(addonTier.amount) : MIN_ITEM_AMOUNT
    if (addonTier.freeAmount && itemAmount < itemMinimum)
      return { ok: false, error: `Le montant minimum pour « ${addonTier.label} » est de ${itemMinimum}€.` }
    addons.push({
      tierId: addonTier.id, itemType: addonTier.itemType as "ADDON" | "DONATION",
      label: addonTier.label, amount: itemAmount,
      receiptMode:      addonTier.receiptMode,
      deductibleAmount: eligibleReceiptAmount(itemAmount, addonTier.receiptMode, addonTier.ineligibleAmount != null ? Number(addonTier.ineligibleAmount) : null),
    })
  }
  return { ok: true, addons }
}

const schema = z.object({
  tierId:      z.string().min(1),
  paymentMethod: z.enum(["STRIPE", "ESPECES", "CHEQUE", "VIREMENT"]).optional().default("STRIPE"),
  amount:      z.number().positive().max(100000).optional(), // requis seulement si le tier est à montant libre
  firstName:   z.string().trim().min(1).max(100),
  lastName:    z.string().trim().min(1).max(100),
  email:       z.string().email().max(200),
  password:    z.string().min(8).optional(), // requis seulement si l'adhésion sera immédiate
  address:     z.string().trim().max(300).optional(),
  birthDate:   z.string().trim().max(20).optional(),
  phone:       z.string().trim().max(30).optional(),
  mobile:      z.string().trim().max(30).optional(),
  // Mirrors Membre.sexe's own two values — a plain free-text "genre" field had nowhere real
  // to live on Membre, so the public form now offers the same two options as the admin's
  // own membre-form.tsx (sexeOptions) instead of a string headed for a Json blob.
  sexe:        z.enum(["HOMME", "FEMME"]).optional(),
  spokenLanguage: z.enum(SPOKEN_LANGUAGE_CODES).optional(),
  photoUrl:    z.string().url().max(500).optional(),
  payInInstallments: z.boolean().optional().default(false),
  // The page's own locale (LocaleSwitcher, next-intl) — the visitor already picked it to view
  // the form, so it's captured here rather than asking again. Not yet used to localize any
  // outbound email — see Membre.preferredLocale in schema.prisma.
  locale:      z.enum(["fr", "en", "pt", "pt-PT", "es"]).optional(),
  answers:     z.record(z.string(), z.string().max(500)).optional().default({}),
  addons:      z.array(z.object({
    tierId: z.string().min(1),
    amount: z.number().positive().max(100000).optional(), // requis seulement pour une option à montant libre
  })).max(20).optional().default([]),
  // Produits Boutique choisis en fin d'adhésion — jamais sur le multiSchema/registrantSchema
  // (ni sur un tarif RECURRING ou payé en plusieurs fois, voir le garde-fou plus bas) : le
  // stock n'est décompté qu'une fois, au moment du paiement unique via webhook (voir
  // membership-form-products.ts), un rail qu'aucun de ces autres chemins n'emprunte.
  products:    z.array(z.object({
    varianteId: z.string().min(1),
    quantity:   z.number().int().min(1).max(99),
  })).max(10).optional().default([]),
  conditionsAgreed: z.boolean().optional().default(false),
  // Honeypot — jamais rempli par un vrai visiteur (masqué hors écran), même convention que
  // les autres formulaires publics.
  website:     z.string().optional().or(z.literal("")),
})

// One "Adhérent" block on the public form's multi-registrant mode (see membership-form-
// public-form.tsx's "Ajouter un autre adhérent") — no email/password/paymentMethod/addons of
// its own, those stay shared across the whole submission (multiSchema below).
const registrantSchema = z.object({
  tierId:    z.string().min(1),
  amount:    z.number().positive().max(100000).optional(), // requis seulement si le tier est à montant libre
  firstName: z.string().trim().min(1).max(100),
  lastName:  z.string().trim().min(1).max(100),
  birthDate: z.string().trim().max(20).optional(),
  phone:     z.string().trim().max(30).optional(),
  mobile:    z.string().trim().max(30).optional(),
  sexe:      z.enum(["HOMME", "FEMME"]).optional(),
  spokenLanguage: z.enum(SPOKEN_LANGUAGE_CODES).optional(),
  address:   z.string().trim().max(300).optional(),
  photoUrl:  z.string().url().max(500).optional(),
  answers:   z.record(z.string(), z.string().max(500)).optional().default({}),
})

// A deliberately separate schema/branch (handleMultiRegistrantCheckout below) rather than
// folding this into `schema` above — that would have meant making tierId/firstName/lastName
// optional there too, weakening the single-registrant path's own types for zero benefit to
// it. Kept minimal: Stripe-only, one tarif per person, and no per-registrant email (one shared
// login for the whole submission). `addons` and `products` are the two exceptions — never
// attached to a particular registrant, always attributed in full to registrants[0], the only
// person in the group with a real email/login.
const multiSchema = z.object({
  registrants: z.array(registrantSchema).min(2).max(MAX_REGISTRANTS),
  // Même forme que `addons` du parcours à un seul adhérent — un groupe doit pouvoir ajouter
  // un don ou une option comme n'importe quel adhérent seul.
  addons:      z.array(z.object({
    tierId: z.string().min(1),
    amount: z.number().positive().max(100000).optional(),
  })).max(20).optional().default([]),
  email:       z.string().email().max(200),
  password:    z.string().min(8).optional(), // requis seulement si l'adhésion sera immédiate
  conditionsAgreed: z.boolean().optional().default(false),
  website:     z.string().optional().or(z.literal("")),
  locale:      z.enum(["fr", "en", "pt", "pt-PT", "es"]).optional(),
  // Contrairement au reste de ce schéma, jamais rattaché à un registrant précis : le groupe
  // n'a qu'un seul email/login réel (registrants[0], voir handleMultiRegistrantCheckout), donc
  // le produit lui est toujours attribué en entier plutôt que d'être réparti entre les
  // personnes du groupe.
  products:    z.array(z.object({
    varianteId: z.string().min(1),
    quantity:   z.number().int().min(1).max(99),
  })).max(10).optional().default([]),
})

type ResolvedProduct = { varianteId: string; produitId: string; label: string; quantity: number; unitPriceCents: number }

// Partagé entre le parcours à un seul adhérent et l'inscription groupée — mêmes règles de
// validation/re-tarification server-side dans les deux cas (voir le commentaire détaillé sur
// resolvedProducts dans le parcours à un seul adhérent, plus bas, pour le raisonnement complet).
function resolveRequestedProducts(
  form: { products: { varianteId: string; variante: { id: string; produitId: string; label: string; price: number; stock: number; produit: { status: string } } }[] },
  modules: { boutique: boolean },
  requested: { varianteId: string; quantity: number }[],
): { error: string } | { products: ResolvedProduct[]; totalCents: number } {
  const varianteIds = new Set(requested.map(p => p.varianteId))
  if (varianteIds.size !== requested.length) return { error: "Produits en double" }

  const products: ResolvedProduct[] = []
  for (const p of requested) {
    const offer = modules.boutique ? form.products.find(fp => fp.varianteId === p.varianteId) : undefined
    if (!offer || offer.variante.produit.status !== "ACTIVE")
      return { error: "Produit invalide" }
    if (offer.variante.stock < p.quantity)
      return { error: `Stock insuffisant pour « ${offer.variante.label} » (disponible : ${offer.variante.stock})` }
    products.push({
      varianteId: offer.variante.id, produitId: offer.variante.produitId, label: offer.variante.label,
      quantity: p.quantity, unitPriceCents: offer.variante.price,
    })
  }
  return { products, totalCents: products.reduce((sum, p) => sum + p.unitPriceCents * p.quantity, 0) }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ slug: string; formSlug: string }> },
) {
  const { slug, formSlug } = await params

  if (!(await rateLimit(`membership-form-checkout:${requestIp(req)}`, 5, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de tentatives, réessayez plus tard." }, { status: 429 })
  }

  const body = await req.json().catch(() => null)

  // Detected off the raw body, before either schema runs: a single-registrant payload never
  // has a `registrants` array, so this can't misfire on it.
  if (Array.isArray((body as { registrants?: unknown } | null)?.registrants) && (body as { registrants: unknown[] }).registrants.length >= 2) {
    const parsedMulti = multiSchema.safeParse(body)
    if (!parsedMulti.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })
    return handleMultiRegistrantCheckout(req, slug, formSlug, parsedMulti.data)
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })

  // Pretend success without touching the DB or Stripe — same anti-bot convention as the
  // donation-form checkout route.
  if (parsed.data.website) return NextResponse.json({ pending: true })

  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: { id: true, name: true, modules: true, stripeConnectId: true, plan: true, customBrandingEnabled: true, logoUrl: true, canIssueTaxReceipts: true },
  })
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const modules = parseModules(assoc.modules)
  if (!modules.cotisations) return NextResponse.json({ error: "Module adhésions désactivé" }, { status: 403 })

  const form = await prisma.membershipForm.findFirst({
    where:   { slug: formSlug, associationId: assoc.id, status: "PUBLISHED", visibility: { not: "PRIVATE" } },
    include: {
      tiers: true, customFields: true,
      products: { include: { variante: { include: { produit: { select: { status: true } } } } } },
    },
  })
  if (!form) return NextResponse.json({ error: "Formulaire introuvable" }, { status: 404 })

  const now = new Date()
  if (form.opensAt && form.opensAt > now) return NextResponse.json({ error: "Ce formulaire n'est pas encore ouvert." }, { status: 422 })
  if (form.closesAt && form.closesAt < now) return NextResponse.json({ error: "Ce formulaire est fermé." }, { status: 422 })

  // Le client refuse déjà de soumettre sans cette case cochée quand le formulaire l'exige —
  // revalidé ici pour ne jamais dépendre uniquement d'un contrôle contournable côté client.
  if (form.requireCguvSignature && !parsed.data.conditionsAgreed)
    return NextResponse.json({ error: "Vous devez accepter les conditions générales pour adhérer." }, { status: 422 })

  const tier = form.tiers.find(t => t.id === parsed.data.tierId && t.itemType === "MEMBERSHIP")
  if (!tier) return NextResponse.json({ error: "Tarif invalide" }, { status: 422 })

  // null = comportement historique (année civile, aucune borne explicite). Un
  // MembershipTier.durationMonths rend l'adhésion valable ce nombre de mois à partir de
  // maintenant plutôt que jusqu'au 31 décembre — voir src/lib/membre-adherent.ts, qui traite
  // periodEnd comme prioritaire sur `year` dès qu'il est posé. fixedPeriodEnd est l'alternative
  // à durationMonths (mutuellement exclusifs, voir tiers/route.ts) — même date de fin pour
  // tout le monde peu importe la date de paiement.
  const periodStart = tier.fixedPeriodEnd || tier.durationMonths ? now : null
  const periodEnd    = tier.fixedPeriodEnd ?? (tier.durationMonths ? addMonths(now, tier.durationMonths) : null)

  const addonsResult = resolveAddons(form.tiers, parsed.data.addons)
  if (!addonsResult.ok) return NextResponse.json({ error: addonsResult.error }, { status: 422 })
  const resolvedAddons = addonsResult.addons
  const totalAddons = resolvedAddons.reduce((sum, a) => sum + a.amount, 0)

  // Produits Boutique proposés en fin de formulaire — validés et re-tarifés server-side à
  // partir du stock/prix en direct, jamais repris du payload, même raisonnement que les
  // options ci-dessus. Toujours vide en dehors du rail ONE_OFF/paiement unique (voir le
  // garde-fou juste après) — c'est le seul chemin dont le webhook décompte réellement le
  // stock (voir membership-form-products.ts).
  const productsResult = resolveRequestedProducts(form, modules, parsed.data.products)
  if ("error" in productsResult) return NextResponse.json({ error: productsResult.error }, { status: 422 })
  const { products: resolvedProducts, totalCents: totalProductsCents } = productsResult
  // Défense en profondeur : structurellement, resolvedProducts ne peut déjà rejoindre que le
  // rail ONE_OFF/paiement unique plus bas (aucun autre branch n'y touche), mais un payload
  // trafiqué pourrait combiner un tarif RECURRING ou "plusieurs fois" avec des produits —
  // un tarif gratuit reste ONE_OFF pour le paiement (voir effectiveKind plus bas).
  if (resolvedProducts.length > 0 && ((tier.free ? "ONE_OFF" : tier.kind) !== "ONE_OFF" || parsed.data.payInInstallments))
    return NextResponse.json({ error: "Les produits ne sont pas disponibles avec ce mode de paiement." }, { status: 422 })

  // A paid tier — or a free tier picking up a paid extra — is always immediate as soon as
  // payment is confirmed; there's nothing sensible to "hold for approval" once money has
  // already changed hands. Only a fully free submission is ever routed through the form's
  // own validationMode.
  const willBeImmediate = !tier.free || totalAddons > 0 || totalProductsCents > 0 || form.validationMode === "IMMEDIATE"
  if (willBeImmediate && !parsed.data.password)
    return NextResponse.json({ error: "Un mot de passe est requis." }, { status: 422 })

  // La matrice de champs standards (étape 3 de l'assistant) rend certains champs
  // obligatoires — validée ici plutôt que par un schéma zod statique puisqu'elle est
  // configurée par formulaire, même raisonnement que les DonationFormField.
  const { address, birthDate, phone, mobile, sexe, spokenLanguage, photoUrl: photoUrlValue } = parsed.data
  const standardChecks: [string, string | undefined, string][] = [
    [form.fieldAddress,   address,   "Adresse"],
    [form.fieldBirthDate, birthDate, "Date de naissance"],
    [form.fieldPhone,     phone,     "Téléphone"],
    [form.fieldMobile,    mobile,    "Mobile"],
    [form.fieldGender,    sexe,      "Genre"],
    [form.fieldLanguage,  spokenLanguage, "Langue parlée"],
    [form.fieldPhoto,     photoUrlValue, "Photo"],
  ]
  for (const [requirement, value, label] of standardChecks) {
    if (requirement === "REQUIRED" && (!value || !value.trim()))
      return NextResponse.json({ error: `Le champ « ${label} » est requis.` }, { status: 422 })
  }

  const knownFieldIds = new Set(form.customFields.map(f => f.id))
  for (const field of form.customFields) {
    const value = parsed.data.answers[field.id]
    if (field.required && (value == null || value.trim() === ""))
      return NextResponse.json({ error: `Le champ « ${field.label} » est requis.` }, { status: 422 })
  }

  // birthDate/sexe ont leurs propres colonnes sur Membre (voir plus bas) — seul "mobile"
  // (qui n'a pas de colonne dédiée) et les réponses aux MembershipFormField, keyed par id,
  // vont dans Membre.answers — même convention que Don.answers.
  const answers: Record<string, string> = {
    ...(mobile ? { mobile } : {}),
    ...Object.fromEntries(Object.entries(parsed.data.answers).filter(([k]) => knownFieldIds.has(k))),
  }
  const birthDateValue = birthDate ? new Date(birthDate) : null

  const { firstName, lastName, email, address: addressValue, photoUrl, locale } = parsed.data
  const acceptedIp = consentIp(req)

  const existing = await prisma.membre.findFirst({
    where: { associationId: assoc.id, email, deletedAt: null },
  })
  if (existing) return NextResponse.json({ error: "Cette adresse email est déjà utilisée." }, { status: 409 })

  // ─── Tarif gratuit (sans option payante) ───────────────────────────────────────
  // resolvedProducts.length === 0 est requis ici aussi : sans ça, une tarif gratuite
  // combinée à un produit passait entièrement à côté de Stripe — le membre était créé sans
  // jamais payer le produit, ni décompter son stock.
  if (tier.free && totalAddons === 0 && resolvedProducts.length === 0) {
    try {
      await assertMemberLimit(assoc.id)
    } catch (err) {
      if (err instanceof MemberLimitReachedError) return NextResponse.json({ error: MEMBER_LIMIT_VISITOR_MESSAGE }, { status: 422 })
      throw err
    }

    if (!willBeImmediate) {
      // Same shape as the legacy /api/public/[slug]/inscription route — no User yet, so
      // consent is stamped on the Membre itself (see Membre.termsAcceptedAt in schema.prisma).
      const membre = await prisma.membre.create({
        data: {
          firstName, lastName, email,
          phone:         phone || null,
          address:       addressValue || null,
          birthDate:     birthDateValue,
          sexe:          sexe || null,
          spokenLanguage: spokenLanguage || null,
          photoUrl:      photoUrl || null,
          preferredLocale: locale || null,
          status:        "PENDING",
          associationId: assoc.id,
          typeId:        tier.membreTypeId,
          // Read once by PATCH /api/membres/[id] when an admin approves this request, to
          // auto-create the matching (free) Cotisation — see Membre.pendingTierId.
          pendingTierId: tier.id,
          answers:       Object.keys(answers).length ? answers : undefined,
          termsAcceptedAt: parsed.data.conditionsAgreed ? now : undefined,
          termsVersion:    parsed.data.conditionsAgreed ? CURRENT_TERMS_VERSION : undefined,
          termsAcceptedIp: parsed.data.conditionsAgreed ? (acceptedIp ?? undefined) : undefined,
        },
      })

      await writeActivityLog({
        associationId: assoc.id, action: "MEMBRE_INSCRIPTION_REQUESTED", entity: "Membre", entityId: membre.id,
        label: `${firstName} ${lastName} (${form.title})`,
      })

      sendEmail(membershipPendingValidationEmail({
        firstName, email, associationName: assoc.name, formTitle: form.title,
        branding: resolveDocumentBranding(assoc),
      }), { associationId: assoc.id, membreId: membre.id, source: "TRANSACTION" }).catch(() => {})

      notifyMembershipSignup({
        associationId: assoc.id, formTitle: form.title, adminNotificationEmail: form.adminNotificationEmail,
        memberNames: [`${firstName} ${lastName}`], amount: 0, primaryMembreId: membre.id, pendingValidation: true,
      }).catch(() => {})

      return NextResponse.json({ pending: true })
    }

    const passwordHash = await bcrypt.hash(parsed.data.password!, 12)

    let user, membre
    try {
      ({ user, membre } = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email, name: `${firstName} ${lastName}`, passwordHash, role: "MEMBRE", associationId: assoc.id,
            termsAcceptedAt: now, termsVersion: CURRENT_TERMS_VERSION, termsAcceptedIp: acceptedIp ?? undefined,
          },
        })
        const membre = await tx.membre.create({
          data: {
            firstName, lastName, email,
            phone:         phone || null,
            address:       addressValue || null,
            birthDate:     birthDateValue,
            sexe:          sexe || null,
            spokenLanguage: spokenLanguage || null,
            photoUrl:      photoUrl || null,
            preferredLocale: locale || null,
            status:        "ACTIF",
            associationId: assoc.id,
            typeId:        tier.membreTypeId,
            userId:        user.id,
            answers:       Object.keys(answers).length ? answers : undefined,
          },
        })
        await tx.cotisation.create({
          data: {
            membreId: membre.id, associationId: assoc.id, year: currentCotisationYear(now),
            amount: 0, amountPaid: 0, status: "EXONERE", paidAt: now,
            membershipFormId: form.id, tierId: tier.id,
            periodStart, periodEnd, receiptMode: tier.receiptMode,
            deductibleAmount: eligibleReceiptAmount(0, tier.receiptMode, tier.ineligibleAmount != null ? Number(tier.ineligibleAmount) : null),
          },
        })
        return { user, membre }
      }))
    } catch (err) {
      // A concurrent submission (double-click, two tabs) can win the race between the
      // `existing` check above and this transaction — no money changed hands yet here
      // (unlike the paid branches' webhook-side P2002 handling), so a friendly 409 is
      // enough; there's nothing to reconcile.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")
        return NextResponse.json({ error: "Cette adresse email est déjà utilisée." }, { status: 409 })
      throw err
    }

    const branding = resolveDocumentBranding(assoc)
    sendEmail(membershipWelcomeEmail({
      firstName, email, associationName: assoc.name, amount: 0,
      loginUrl: `${APP_URL}/portal/${slug}/login`, branding,
      canIssueTaxReceipts: assoc.canIssueTaxReceipts, receiptMode: tier.receiptMode,
      deductibleAmount: eligibleReceiptAmount(0, tier.receiptMode, tier.ineligibleAmount != null ? Number(tier.ineligibleAmount) : null) ?? undefined,
    }), { associationId: assoc.id, membreId: membre.id, source: "TRANSACTION", sourceId: user.id }).catch(() => {})

    await writeActivityLog({
      associationId: assoc.id, action: "MEMBRE_CREATED", entity: "Membre", entityId: membre.id,
      label: `${firstName} ${lastName} (${form.title})`,
    })

    fireEventRule({
      triggerType: "MEMBER_CREATED",
      associationId: assoc.id,
      association: { name: assoc.name, slug, modules: assoc.modules, plan: assoc.plan, customBrandingEnabled: assoc.customBrandingEnabled, logoUrl: assoc.logoUrl },
      membre: { id: membre.id, firstName: membre.firstName, lastName: membre.lastName, email: membre.email, phone: membre.phone },
    }).catch(() => {})

    notifyMembershipSignup({
      associationId: assoc.id, formTitle: form.title, adminNotificationEmail: form.adminNotificationEmail,
      memberNames: [`${firstName} ${lastName}`], amount: 0, primaryMembreId: membre.id,
    }).catch(() => {})

    return NextResponse.json({ immediate: true })
  }

  // ─── Tarifs payants ───────────────────────────────────────────────────────────
  const { paymentMethod } = parsed.data
  const isOffline = paymentMethod !== "STRIPE"

  if (isOffline) {
    // Espèces/chèque/virement are a manual, one-time act on the visitor's side — there's no
    // equivalent of a recurring cheque arriving on its own every year, same reasoning as the
    // donation-form checkout route.
    if (tier.kind === "RECURRING")
      return NextResponse.json({ error: "Le paiement hors ligne n'est pas disponible pour un tarif récurrent." }, { status: 400 })
    // Les options (add-on/don) ne passent que par Stripe — un montant additionnel réglé hors
    // ligne n'a pas de suivi d'encaissement dédié côté MembershipAddonPurchase, contrairement
    // à Cotisation/Don. Le client masque déjà ce choix dès qu'une option est cochée.
    if (totalAddons > 0)
      return NextResponse.json({ error: "Le paiement hors ligne n'est pas disponible avec des options supplémentaires." }, { status: 400 })
    // Même raisonnement que les options ci-dessus : un produit n'est jamais décompté/vendu
    // que via le webhook Stripe (voir membership-form-products.ts) — un paiement hors ligne
    // ne passe jamais par ce webhook.
    if (resolvedProducts.length > 0)
      return NextResponse.json({ error: "Le paiement hors ligne n'est pas disponible avec des produits." }, { status: 400 })
    const allowed = paymentMethod === "ESPECES" ? form.allowCash : paymentMethod === "CHEQUE" ? form.allowCheque : form.allowTransfer
    if (!allowed) return NextResponse.json({ error: "Ce moyen de paiement n'est pas disponible pour ce formulaire" }, { status: 400 })
  } else {
    if (!assoc.stripeConnectId || !(await connectAccountChargesEnabled(assoc.stripeConnectId)))
      return NextResponse.json({ error: "Paiement en ligne non disponible pour le moment." }, { status: 400 })
  }

  try {
    await assertMemberLimit(assoc.id)
  } catch (err) {
    if (err instanceof MemberLimitReachedError) return NextResponse.json({ error: MEMBER_LIMIT_VISITOR_MESSAGE }, { status: 422 })
    throw err
  }

  const membershipAmount = tier.free ? 0 : (tier.freeAmount ? parsed.data.amount : Number(tier.amount))
  if (!tier.free && (!membershipAmount || membershipAmount <= 0))
    return NextResponse.json({ error: "Montant invalide" }, { status: 422 })
  // Même plancher que le parcours multi-inscrits pour un tarif à montant libre sans minimum
  // configuré (voir le commentaire de MIN_ITEM_AMOUNT plus haut).
  if (!tier.free && tier.freeAmount) {
    const tierMinimum = tier.amount != null ? Number(tier.amount) : MIN_ITEM_AMOUNT
    if ((membershipAmount ?? 0) < tierMinimum)
      return NextResponse.json({ error: `Le montant minimum pour « ${tier.label} » est de ${tierMinimum}€.` }, { status: 422 })
  }
  // Le montant non éligible est une part fixe du tarif — un adhérent payant moins que cette
  // part (montant libre en dessous du non-éligible configuré) donnerait un reçu à montant
  // négatif (voir eligibleReceiptAmount).
  if (tier.receiptMode === "PARTIAL" && tier.ineligibleAmount != null && (membershipAmount ?? 0) < Number(tier.ineligibleAmount))
    return NextResponse.json({ error: "Le montant payé ne peut pas être inférieur au montant non éligible au reçu fiscal configuré pour ce tarif." }, { status: 422 })
  const amount = (membershipAmount ?? 0) + totalAddons // amount total réellement dû (tarif + options)
  if (!amount || amount <= 0)
    return NextResponse.json({ error: "Montant invalide" }, { status: 422 })

  const passwordHash = await bcrypt.hash(parsed.data.password!, 12)

  if (isOffline) {
    // No Stripe object at all here — the Cotisation stays EN_ATTENTE until an admin records
    // the payment (same "encaissement" reasoning as an offline Don), but the account itself
    // is created right away so the new member can already access their portal.
    let user, membre
    try {
      ({ user, membre } = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email, name: `${firstName} ${lastName}`, passwordHash, role: "MEMBRE", associationId: assoc.id,
            termsAcceptedAt: now, termsVersion: CURRENT_TERMS_VERSION, termsAcceptedIp: acceptedIp ?? undefined,
          },
        })
        const membre = await tx.membre.create({
          data: {
            firstName, lastName, email,
            phone:         phone || null,
            address:       addressValue || null,
            birthDate:     birthDateValue,
            sexe:          sexe || null,
            spokenLanguage: spokenLanguage || null,
            photoUrl:      photoUrl || null,
            preferredLocale: locale || null,
            status:        "ACTIF",
            associationId: assoc.id,
            typeId:        tier.membreTypeId,
            userId:        user.id,
            answers:       Object.keys(answers).length ? answers : undefined,
          },
        })
        await tx.cotisation.create({
          data: {
            membreId: membre.id, associationId: assoc.id, year: currentCotisationYear(now),
            amount, status: "EN_ATTENTE",
            membershipFormId: form.id, tierId: tier.id,
            periodStart, periodEnd, receiptMode: tier.receiptMode,
            deductibleAmount: eligibleReceiptAmount(membershipAmount ?? 0, tier.receiptMode, tier.ineligibleAmount != null ? Number(tier.ineligibleAmount) : null),
          },
        })
        return { user, membre }
      }))
    } catch (err) {
      // Same race as the free-immediate branch above — no money has actually settled yet
      // (offline payment is still pending encaissement), so a friendly 409 is enough.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")
        return NextResponse.json({ error: "Cette adresse email est déjà utilisée." }, { status: 409 })
      throw err
    }

    const branding = resolveDocumentBranding(assoc)
    sendEmail(membershipWelcomeEmail({
      firstName, email, associationName: assoc.name, amount,
      offlinePending: true, offlineInstructions: form.offlineInstructions,
      loginUrl: `${APP_URL}/portal/${slug}/login`, branding,
      canIssueTaxReceipts: assoc.canIssueTaxReceipts, receiptMode: tier.receiptMode,
      deductibleAmount: eligibleReceiptAmount(membershipAmount ?? 0, tier.receiptMode, tier.ineligibleAmount != null ? Number(tier.ineligibleAmount) : null) ?? undefined,
    }), { associationId: assoc.id, membreId: membre.id, source: "TRANSACTION", sourceId: user.id }).catch(() => {})

    await writeActivityLog({
      associationId: assoc.id, action: "MEMBRE_CREATED", entity: "Membre", entityId: membre.id,
      label: `${firstName} ${lastName} (${form.title}, ${paymentMethod})`,
    })

    fireEventRule({
      triggerType: "MEMBER_CREATED",
      associationId: assoc.id,
      association: { name: assoc.name, slug, modules: assoc.modules, plan: assoc.plan, customBrandingEnabled: assoc.customBrandingEnabled, logoUrl: assoc.logoUrl },
      membre: { id: membre.id, firstName: membre.firstName, lastName: membre.lastName, email: membre.email, phone: membre.phone },
    }).catch(() => {})

    notifyMembershipSignup({
      associationId: assoc.id, formTitle: form.title, adminNotificationEmail: form.adminNotificationEmail,
      memberNames: [`${firstName} ${lastName}`], amount, primaryMembreId: membre.id,
    }).catch(() => {})

    return NextResponse.json({ offline: true })
  }

  const successUrl   = `${APP_URL}/${slug}/adhesion/${formSlug}?payment=success`
  const cancelUrl    = `${APP_URL}/${slug}/adhesion/${formSlug}?payment=cancelled`

  const commonMeta = {
    associationId:   assoc.id,
    membershipFormId: form.id,
    tierId:           tier.id,
    firstName,
    lastName,
    email,
    phone:            phone || "",
    typeId:           tier.membreTypeId || "",
    passwordHash,
    address:          addressValue || "",
    birthDate:        birthDate || "",
    sexe:             sexe || "",
    spokenLanguage:   spokenLanguage || "",
    photoUrl:         photoUrl || "",
    locale:           locale || "",
    answers:          JSON.stringify(answers),
    termsAcceptedIp:  acceptedIp ?? "",
    termsVersion:     CURRENT_TERMS_VERSION,
    // Le webhook ne peut pas déduire la part "adhésion" de session.amount_total une fois que
    // des options (montant variable) sont mêlées au même paiement — snapshotée ici plutôt que
    // recalculée côté webhook.
    membershipAmount: String(membershipAmount ?? 0),
    tierFree:         tier.free ? "1" : "",
    addons:           JSON.stringify(resolvedAddons),
    // Clés minimales (identité + quantité) plutôt qu'un snapshot complet comme resolvedAddons
    // ci-dessus — label/prix sont toujours re-dérivables en direct depuis BoutiqueVariante/
    // BoutiqueProduit au moment du webhook (voir membership-form-products.ts), inutile de les
    // dupliquer ici alors que Stripe plafonne chaque valeur de metadata à 500 caractères.
    products:         JSON.stringify(resolvedProducts.map(p => ({ v: p.varianteId, q: p.quantity }))),
    productsAmount:   String(totalProductsCents / 100),
    // Snapshotted for the webhooks — see the periodStart/periodEnd comment above. durationMonths
    // is also carried separately so handleCotisationSubscriptionCheckout can snapshot it onto
    // CotisationSubscription for every future renewal (handleCotisationInvoicePaid), not just
    // this first period.
    periodStart:      periodStart ? periodStart.toISOString() : "",
    periodEnd:        periodEnd ? periodEnd.toISOString() : "",
    durationMonths:   tier.durationMonths ? String(tier.durationMonths) : "",
    receiptMode:      tier.receiptMode,
    deductibleAmount: eligibleReceiptAmount(membershipAmount ?? 0, tier.receiptMode, tier.ineligibleAmount != null ? Number(tier.ineligibleAmount) : null)?.toString() ?? "",
  }

  // Une option payante à côté d'une adhésion gratuite n'a rien de "récurrent" en soi — elle
  // fait basculer tout le paiement sur le rail ponctuel, l'adhésion elle-même restant
  // EXONERE/gratuite (voir handleMembershipOneOffCheckout).
  const effectiveKind = tier.free ? "ONE_OFF" : tier.kind

  const addonLineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = resolvedAddons.map(a => ({
    price_data: {
      currency:     "eur",
      unit_amount:  Math.round(a.amount * 100),
      product_data: { name: `${a.label} — ${assoc.name}` },
    },
    quantity: 1,
  }))

  // Uniquement non-vide sur le rail ONE_OFF (voir le garde-fou plus haut) — jamais mêlé aux
  // branches installments/RECURRING plus bas.
  const productLineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = resolvedProducts.map(p => ({
    price_data: {
      currency:     "eur",
      unit_amount:  p.unitPriceCents,
      product_data: { name: `${p.label} — ${assoc.name}` },
    },
    quantity: p.quantity,
  }))

  // ─── Tarif ponctuel, payé en plusieurs fois ────────────────────────────────────
  // A Stripe Subscription rather than a genuine recurring membership — see MembershipTier.
  // installmentsAllowed. Checkout's subscription_data has no cancel_at field (only settable
  // on the Subscription resource once it exists), so capping it at installmentsCount cycles
  // happens in handleMembershipInstallmentCheckout (src/lib/webhook/membership-installments.ts)
  // right after checkout.session.completed, not here. Never combined with addons/extras (see
  // canPayInInstallments in membership-form-public-form.tsx) — the client already hides the
  // option once any extra is selected, this re-checks server-side.
  if (effectiveKind === "ONE_OFF" && parsed.data.payInInstallments && tier.installmentsAllowed && tier.installmentsCount && resolvedAddons.length === 0) {
    const totalCents = Math.round((membershipAmount ?? 0) * 100)
    // ceil, not round: the last cycle can't carry a smaller top-up amount the way a one-off
    // charge could, so every cycle is priced to guarantee at least the tier's nominal amount
    // is collected across installmentsCount cycles — the (at most installmentsCount - 1
    // cents) overage is stored as the Cotisation's real amount below, never tier.amount
    // itself, so recordCotisationPayment's overpayment guard never misfires on the last one.
    const perInstallmentCents = Math.ceil(totalCents / tier.installmentsCount)

    const installmentMeta = {
      kind: "membership-installment", ...commonMeta,
      installmentsCount: String(tier.installmentsCount),
      perInstallmentAmount: String(perInstallmentCents / 100),
    }

    let checkoutSession: Stripe.Checkout.Session
    try {
      checkoutSession = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [
          {
            price_data: {
              currency:     "eur",
              unit_amount:  perInstallmentCents,
              recurring:    { interval: "month", interval_count: 1 },
              product_data: { name: `${form.title} — ${assoc.name} (${tier.installmentsCount}x)` },
            },
            quantity: 1,
          },
        ],
        subscription_data: {
          transfer_data: { destination: assoc.stripeConnectId! },
          metadata:      installmentMeta,
        },
        metadata:       installmentMeta,
        customer_email: email,
        success_url:    successUrl,
        cancel_url:     cancelUrl,
      })
    } catch (err) {
      console.error(`[membership-checkout] Stripe session creation failed for form ${form.id}:`, err)
      return NextResponse.json({ error: "Erreur lors de la création du paiement" }, { status: 500 })
    }

    if (!checkoutSession.url)
      return NextResponse.json({ error: "Erreur lors de la création du paiement" }, { status: 500 })

    return NextResponse.json({ url: checkoutSession.url })
  }

  // ─── Tarif ponctuel (paiement unique) ──────────────────────────────────────────
  if (effectiveKind === "ONE_OFF") {
    // No DB row created ahead of time — a Membre isn't created until Stripe confirms
    // payment, mirroring how the recurring branch below (and the legacy paid inscription
    // route) carries donor/member identity through Stripe metadata instead of a pre-made
    // row, since there's nothing to key one on before checkout.session.completed arrives.
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      ...(membershipAmount ? [{
        price_data: {
          currency:     "eur" as const,
          unit_amount:  Math.round(membershipAmount * 100),
          product_data: { name: `${form.title} — ${assoc.name}` },
        },
        quantity: 1,
      }] : []),
      ...addonLineItems,
      ...productLineItems,
    ]

    let checkoutSession: Stripe.Checkout.Session
    try {
      checkoutSession = await stripe.checkout.sessions.create({
        mode: "payment",
        line_items: lineItems,
        payment_intent_data: {
          // Non-null: the `else` branch above already returned if this were unset — that
          // narrowing doesn't survive past the offline branch's own early return in between.
          transfer_data: { destination: assoc.stripeConnectId! },
          metadata:      { kind: "membership-oneoff", ...commonMeta },
        },
        metadata:       { kind: "membership-oneoff", ...commonMeta },
        customer_email: email,
        success_url:    successUrl,
        cancel_url:     cancelUrl,
      })
    } catch (err) {
      console.error(`[membership-checkout] Stripe session creation failed for form ${form.id}:`, err)
      return NextResponse.json({ error: "Erreur lors de la création du paiement" }, { status: 500 })
    }

    if (!checkoutSession.url)
      return NextResponse.json({ error: "Erreur lors de la création du paiement" }, { status: 500 })

    return NextResponse.json({ url: checkoutSession.url })
  }

  // ─── Tarif récurrent (annuel) ───────────────────────────────────────────────────
  // Reuses the exact same subscription_data.metadata.kind = "cotisation" shape the legacy
  // /api/public/[slug]/inscription/checkout route already produces, so
  // handleCotisationSubscriptionCheckout (src/lib/webhook/cotisation-subscriptions.ts)
  // resolves it into a Membre/User/CotisationSubscription with no changes of its own beyond
  // reading the two extra membershipFormId/tierId keys. Options ponctuelles ajoutées à côté du
  // prix récurrent deviennent de simples invoice items sur la première facture chez Stripe —
  // elles n'entrent jamais dans subscription.items, donc handleCotisationSubscriptionCheckout
  // n'a pas besoin de connaître membershipAmount pour calculer le montant de l'adhésion.
  const subscriptionMeta = { kind: "cotisation", ...commonMeta }

  let checkoutSession: Stripe.Checkout.Session
  try {
    checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price_data: {
            currency:     "eur",
            unit_amount:  Math.round((membershipAmount ?? 0) * 100),
            // "month"/interval_count rather than a bare "year": Stripe caps interval_count at
            // 1 for a "year" interval, so a custom durationMonths (validated ≤ 12 server-side
            // in tiers/route.ts) can only be expressed this way. interval_count: 12 bills on
            // the same yearly cadence as before for every tier that doesn't set durationMonths.
            recurring:    { interval: "month", interval_count: tier.durationMonths ?? 12 },
            product_data: { name: `${form.title} — ${assoc.name}` },
          },
          quantity: 1,
        },
        ...addonLineItems,
      ],
      subscription_data: {
        // Non-null: the `else` branch above already returned if this were unset — see the
        // matching comment on the one-off branch.
        transfer_data: { destination: assoc.stripeConnectId! },
        metadata:      subscriptionMeta,
      },
      metadata:       subscriptionMeta,
      customer_email: email,
      success_url:    successUrl,
      cancel_url:     cancelUrl,
    })
  } catch (err) {
    console.error(`[membership-checkout] Stripe session creation failed for form ${form.id}:`, err)
    return NextResponse.json({ error: "Erreur lors de la création du paiement" }, { status: 500 })
  }

  if (!checkoutSession.url) {
    return NextResponse.json({ error: "Erreur lors de la création du paiement" }, { status: 500 })
  }

  return NextResponse.json({ url: checkoutSession.url })
}

// ─── Inscription groupée (N ≥ 2 "Adhérent" sur le même formulaire) ────────────────────────
//
// Kept entirely separate from the single-registrant flow above rather than threaded through
// it — the two have different enough shapes (no addons/offline payment, one shared email/
// password, N tiers instead of one) that merging them would have meant sprinkling `if
// (isMulti)` through every branch of an already-long function. A single registrant still goes
// through POST's original path completely unchanged.
async function handleMultiRegistrantCheckout(
  req: Request, slug: string, formSlug: string, data: z.infer<typeof multiSchema>,
): Promise<NextResponse> {
  const now = new Date()

  // Pretend success without touching the DB or Stripe — same anti-bot convention as the
  // single-registrant path.
  if (data.website) return NextResponse.json({ pending: true })

  const assoc = await prisma.association.findUnique({
    where:  { slug },
    select: { id: true, name: true, modules: true, stripeConnectId: true, plan: true, customBrandingEnabled: true, logoUrl: true, canIssueTaxReceipts: true },
  })
  if (!assoc) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const modules = parseModules(assoc.modules)
  if (!modules.cotisations) return NextResponse.json({ error: "Module adhésions désactivé" }, { status: 403 })

  const form = await prisma.membershipForm.findFirst({
    where:   { slug: formSlug, associationId: assoc.id, status: "PUBLISHED", visibility: { not: "PRIVATE" } },
    include: {
      tiers: true, customFields: true,
      products: { include: { variante: { include: { produit: { select: { status: true } } } } } },
    },
  })
  if (!form) return NextResponse.json({ error: "Formulaire introuvable" }, { status: 404 })

  if (form.opensAt && form.opensAt > now) return NextResponse.json({ error: "Ce formulaire n'est pas encore ouvert." }, { status: 422 })
  if (form.closesAt && form.closesAt < now) return NextResponse.json({ error: "Ce formulaire est fermé." }, { status: 422 })
  if (form.requireCguvSignature && !data.conditionsAgreed)
    return NextResponse.json({ error: "Vous devez accepter les conditions générales pour adhérer." }, { status: 422 })

  // Toujours attribué en entier à registrants[0] une fois consommé (voir
  // MembershipCheckoutDraft.products dans schema.prisma) — jamais réparti entre les personnes
  // du groupe, même raisonnement de re-tarification server-side que le parcours à un seul
  // adhérent.
  const productsResult = resolveRequestedProducts(form, modules, data.products)
  if ("error" in productsResult) return NextResponse.json({ error: productsResult.error }, { status: 422 })
  const { products: resolvedProducts, totalCents: totalProductsCents } = productsResult

  // Resolve + validate every registrant's tier — MEMBERSHIP/ONE_OFF only. A Stripe
  // Subscription is tied to exactly one Membre, so a single group checkout can't "split" a
  // recurring tier across N people (same reasoning the public form uses to hide "Ajouter un
  // autre adhérent" once a RECURRING tier is selected).
  const knownFieldIds = new Set(form.customFields.map(f => f.id))
  const resolved: { tier: (typeof form.tiers)[number]; amount: number; r: z.infer<typeof registrantSchema>; answers: Record<string, string> }[] = []
  for (const r of data.registrants) {
    const tier = form.tiers.find(t => t.id === r.tierId && t.itemType === "MEMBERSHIP")
    if (!tier) return NextResponse.json({ error: "Tarif invalide" }, { status: 422 })
    if (tier.kind === "RECURRING")
      return NextResponse.json({ error: "Les tarifs récurrents ne sont pas disponibles pour une inscription groupée." }, { status: 422 })

    const amount = tier.free ? 0 : (tier.freeAmount ? (r.amount ?? 0) : Number(tier.amount))
    if (!tier.free && amount <= 0)
      return NextResponse.json({ error: `Montant invalide pour ${r.firstName} ${r.lastName}` }, { status: 422 })
    // Même plancher que le parcours à un seul adhérent pour un tarif à montant libre sans
    // minimum configuré (voir le commentaire de MIN_ITEM_AMOUNT plus haut).
    const tierMinimum = tier.amount != null ? Number(tier.amount) : MIN_ITEM_AMOUNT
    if (!tier.free && tier.freeAmount && amount < tierMinimum)
      return NextResponse.json({ error: `Le montant minimum pour « ${tier.label} » est de ${tierMinimum}€.` }, { status: 422 })
    // Même garde-fou que le parcours à un seul adhérent — voir le commentaire
    // eligibleReceiptAmount plus haut.
    if (tier.receiptMode === "PARTIAL" && tier.ineligibleAmount != null && amount < Number(tier.ineligibleAmount))
      return NextResponse.json({ error: `Le montant payé pour ${r.firstName} ${r.lastName} ne peut pas être inférieur au montant non éligible au reçu fiscal configuré pour ce tarif.` }, { status: 422 })

    // Même matrice de champs standards que le parcours à un seul adhérent, appliquée à
    // chaque personne individuellement — chaque bloc "Adhérent" produit son propre Membre.
    const standardChecks: [string, string | undefined, string][] = [
      [form.fieldAddress,   r.address,   "Adresse"],
      [form.fieldBirthDate, r.birthDate, "Date de naissance"],
      [form.fieldPhone,     r.phone,     "Téléphone"],
      [form.fieldMobile,    r.mobile,    "Mobile"],
      [form.fieldGender,    r.sexe,      "Genre"],
      [form.fieldLanguage,  r.spokenLanguage, "Langue parlée"],
      [form.fieldPhoto,     r.photoUrl,  "Photo"],
    ]
    for (const [requirement, value, label] of standardChecks) {
      if (requirement === "REQUIRED" && (!value || !value.trim()))
        return NextResponse.json({ error: `Le champ « ${label} » est requis pour ${r.firstName} ${r.lastName}.` }, { status: 422 })
    }
    for (const field of form.customFields) {
      const value = r.answers[field.id]
      if (field.required && (value == null || value.trim() === ""))
        return NextResponse.json({ error: `Le champ « ${field.label} » est requis pour ${r.firstName} ${r.lastName}.` }, { status: 422 })
    }

    // birthDate/sexe ont leurs propres colonnes sur Membre — seul "mobile" (pas de colonne
    // dédiée) et les réponses aux MembershipFormField, keyed par id, vont dans Membre.answers,
    // même filtrage que le parcours à un seul adhérent.
    const answers: Record<string, string> = {
      ...(r.mobile ? { mobile: r.mobile } : {}),
      ...Object.fromEntries(Object.entries(r.answers).filter(([k]) => knownFieldIds.has(k))),
    }

    resolved.push({ tier, amount, r, answers })
  }

  // totalProductsCents/100 inclus ici même s'il n'existe pas de tarif payant dans le groupe :
  // sans ça, un groupe entièrement gratuit + un produit payant retombait dans la branche
  // "tous gratuits" plus bas, qui ne passe jamais par Stripe — même bug de contournement que
  // celui corrigé sur le parcours à un seul adhérent (voir le commentaire sur tier.free plus
  // haut dans ce fichier).
  const addonsResult = resolveAddons(form.tiers, data.addons)
  if (!addonsResult.ok) return NextResponse.json({ error: addonsResult.error }, { status: 422 })
  const resolvedAddons = addonsResult.addons
  const totalAddons = resolvedAddons.reduce((sum, a) => sum + a.amount, 0)

  const totalAmount = resolved.reduce((sum, x) => sum + x.amount, 0) + totalProductsCents / 100 + totalAddons
  // Same reasoning as the single-registrant path's willBeImmediate: any money changing hands
  // is always immediate, only a fully-free group ever goes through the form's validationMode.
  // resolvedProducts.length > 0 is checked on its own, not just via totalAmount — a €0-priced
  // product would otherwise still slip into the "tous gratuits" branch below, which never
  // touches stock/BoutiqueCommande at all (same edge case the single-registrant path's own
  // `resolvedProducts.length === 0` guard closes).
  const willBeImmediate = totalAmount > 0 || resolvedProducts.length > 0 || form.validationMode === "IMMEDIATE"
  if (willBeImmediate && !data.password)
    return NextResponse.json({ error: "Un mot de passe est requis." }, { status: 422 })

  const acceptedIp = consentIp(req)
  const existing = await prisma.membre.findFirst({ where: { associationId: assoc.id, email: data.email, deletedAt: null } })
  if (existing) return NextResponse.json({ error: "Cette adresse email est déjà utilisée." }, { status: 409 })

  try {
    await assertMemberLimit(assoc.id, resolved.length)
  } catch (err) {
    if (err instanceof MemberLimitReachedError) return NextResponse.json({ error: MEMBER_LIMIT_VISITOR_MESSAGE }, { status: 422 })
    throw err
  }

  // ─── Tous gratuits, en attente de validation admin ───────────────────────────────
  if (!willBeImmediate) {
    // Mirrors the single-registrant PENDING branch, once per person — each keeps its own
    // pendingTierId, so the existing per-membre approval flow (PATCH /api/membres/[id],
    // already durationMonths-aware) creates the right Cotisation for each of them
    // individually once an admin reviews them. Linked via responsableId to the person who
    // filled out the form, same as the paid/immediate path below.
    let firstMembreId: string | undefined
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < resolved.length; i++) {
        const { tier, r, answers } = resolved[i]
        const membre = await tx.membre.create({
          data: {
            firstName: r.firstName, lastName: r.lastName,
            email:         i === 0 ? data.email : null,
            phone:         r.phone || null,
            address:       r.address || null,
            birthDate:     r.birthDate ? new Date(r.birthDate) : null,
            sexe:          r.sexe === "HOMME" || r.sexe === "FEMME" ? r.sexe : null,
            spokenLanguage: r.spokenLanguage || null,
            photoUrl:      r.photoUrl || null,
            // Same page, same session for every registrant in this submission — unlike
            // email (person-specific login identity), the locale applies to the whole group.
            preferredLocale: data.locale || null,
            status:        "PENDING",
            associationId: assoc.id,
            typeId:        tier.membreTypeId,
            responsableId: firstMembreId,
            pendingTierId: tier.id,
            answers:       Object.keys(answers).length ? answers : undefined,
            termsAcceptedAt: data.conditionsAgreed ? now : undefined,
            termsVersion:    data.conditionsAgreed ? CURRENT_TERMS_VERSION : undefined,
            termsAcceptedIp: data.conditionsAgreed ? (acceptedIp ?? undefined) : undefined,
          },
        })
        if (i === 0) firstMembreId = membre.id
      }
    })

    await writeActivityLog({
      associationId: assoc.id, action: "MEMBRE_INSCRIPTION_REQUESTED", entity: "Membre", entityId: firstMembreId!,
      label: `${resolved[0].r.firstName} ${resolved[0].r.lastName} + ${resolved.length - 1} (${form.title})`,
    })

    const allNames = resolved.map(({ r }) => `${r.firstName} ${r.lastName}`)

    // Only registrant 0 (data.email) has an email on file in a group submission — see the
    // create loop above — so that's the one and only person who can be reached here.
    sendEmail(membershipPendingValidationEmail({
      firstName: resolved[0].r.firstName, email: data.email, associationName: assoc.name, formTitle: form.title,
      branding: resolveDocumentBranding(assoc), otherRegistrants: allNames.slice(1),
    }), { associationId: assoc.id, membreId: firstMembreId, source: "TRANSACTION" }).catch(() => {})

    notifyMembershipSignup({
      associationId: assoc.id, formTitle: form.title, adminNotificationEmail: form.adminNotificationEmail,
      memberNames: allNames, amount: 0, primaryMembreId: firstMembreId, pendingValidation: true,
    }).catch(() => {})

    return NextResponse.json({ pending: true })
  }

  const passwordHash = await bcrypt.hash(data.password!, 12)

  // Every registrant's identity rides on this draft rather than Stripe metadata — a single
  // person's identity alone already uses ~10 metadata keys (see the single-registrant path's
  // commonMeta), and Stripe's metadata is both size-capped and flat, so N of them won't fit.
  // consumeMembershipCheckoutDraft (src/lib/webhook/membership-multi.ts) is what actually
  // turns this into Membre/Cotisation rows — called directly below for an all-free group
  // (nothing for Stripe to do), or from the webhook once payment confirms otherwise.
  const draft = await prisma.membershipCheckoutDraft.create({
    data: {
      associationId: assoc.id,
      formId:        form.id,
      email:         data.email,
      passwordHash,
      conditionsAgreedAt: data.conditionsAgreed ? now : null,
      termsAcceptedIp:    acceptedIp ?? null,
      // periodStart/periodEnd snapshotted here (submission time), not recomputed when the
      // draft is consumed — the paid path can consume minutes later once the webhook fires,
      // and durationMonths should count from when the visitor actually submitted, mirroring
      // how the single-registrant path freezes them into Stripe metadata at this same point.
      registrants: resolved.map(({ tier, r, answers }) => ({
        tierId: tier.id, amount: r.amount,
        firstName: r.firstName, lastName: r.lastName,
        birthDate: r.birthDate, sexe: r.sexe, spokenLanguage: r.spokenLanguage, phone: r.phone, mobile: r.mobile, address: r.address,
        photoUrl: r.photoUrl,
        // Same page, same session for every registrant — see the equivalent PENDING branch.
        locale: data.locale,
        answers,
        periodStart: tier.fixedPeriodEnd || tier.durationMonths ? now.toISOString() : null,
        periodEnd:   tier.fixedPeriodEnd?.toISOString() ?? (tier.durationMonths ? addMonths(now, tier.durationMonths).toISOString() : null),
      })),
      // [{ v: varianteId, q: quantity }] — mêmes clés minimales que commonMeta.products du
      // parcours à un seul adhérent (voir schema.prisma, MembershipCheckoutDraft.products),
      // toujours attribué à registrants[0] une fois consommé (voir consumeMembershipCheckoutDraft).
      products: resolvedProducts.length
        ? resolvedProducts.map(p => ({ v: p.varianteId, q: p.quantity }))
        : undefined,
      // Snapshot complet (label/montant/reçu inclus) plutôt que les seuls ids, exactement comme
      // metadata.addons du parcours à un seul adhérent : createMembershipAddonPurchases consomme
      // les deux sans distinction, et un tarif modifié entre le paiement et le webhook ne doit
      // pas réécrire ce qui a réellement été facturé.
      addons: resolvedAddons.length ? resolvedAddons : undefined,
      totalAmount,
      expiresAt: new Date(now.getTime() + 30 * 60_000),
    },
  })

  if (totalAmount === 0) {
    const result = await consumeMembershipCheckoutDraft(draft.id)
    if (result.status === "duplicate-email")
      return NextResponse.json({ error: "Cette adresse email est déjà utilisée." }, { status: 409 })
    if (result.status !== "consumed")
      return NextResponse.json({ error: "Erreur lors de la création des comptes" }, { status: 500 })
    return NextResponse.json({ immediate: true })
  }

  if (!assoc.stripeConnectId || !(await connectAccountChargesEnabled(assoc.stripeConnectId)))
    return NextResponse.json({ error: "Paiement en ligne non disponible pour le moment." }, { status: 400 })

  // One line item per paying registrant, itemized so the receipt shows each person's tier
  // separately (per the Fase 2 plan) — a free registrant riding along is simply omitted, same
  // "Stripe rejects a 0-amount price" reasoning the single-registrant ONE_OFF branch already
  // follows for its own membership line item.
  const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = resolved
    .filter(({ amount }) => amount > 0)
    .map(({ tier, amount, r }) => ({
      price_data: {
        currency:     "eur" as const,
        unit_amount:  Math.round(amount * 100),
        product_data: { name: `${tier.label} — ${r.firstName} ${r.lastName} — ${assoc.name}` },
      },
      quantity: 1,
    }))
  // Toujours attribués à registrants[0] (voir le commentaire sur MembershipCheckoutDraft.products
  // plus haut) — le nom de la ligne ne mentionne donc personne en particulier, contrairement
  // aux lignes de tarif ci-dessus.
  for (const p of resolvedProducts) {
    lineItems.push({
      price_data: {
        currency:     "eur" as const,
        unit_amount:  p.unitPriceCents,
        product_data: { name: `${p.label} — ${assoc.name}` },
      },
      quantity: p.quantity,
    })
  }
  // Itemized like everything else on this session, and for the same reason as the products
  // above: the option belongs to the submission, not to one named person in the group.
  for (const a of resolvedAddons) {
    lineItems.push({
      price_data: {
        currency:     "eur" as const,
        unit_amount:  Math.round(a.amount * 100),
        product_data: { name: `${a.label} — ${assoc.name}` },
      },
      quantity: 1,
    })
  }

  const successUrl = `${APP_URL}/${slug}/adhesion/${formSlug}?payment=success`
  const cancelUrl  = `${APP_URL}/${slug}/adhesion/${formSlug}?payment=cancelled`
  const metadata = { kind: "membership-multi", associationId: assoc.id, draftId: draft.id }

  let checkoutSession: Stripe.Checkout.Session
  try {
    checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: lineItems,
      payment_intent_data: {
        // Non-null: the connectAccountChargesEnabled check above already returned if this
        // were unset.
        transfer_data: { destination: assoc.stripeConnectId! },
        metadata,
      },
      metadata,
      customer_email: data.email,
      success_url:    successUrl,
      cancel_url:     cancelUrl,
    })
  } catch (err) {
    console.error(`[membership-multi-checkout] Stripe session creation failed for form ${form.id}:`, err)
    return NextResponse.json({ error: "Erreur lors de la création du paiement" }, { status: 500 })
  }

  if (!checkoutSession.url)
    return NextResponse.json({ error: "Erreur lors de la création du paiement" }, { status: 500 })

  return NextResponse.json({ url: checkoutSession.url })
}
