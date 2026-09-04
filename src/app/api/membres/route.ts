import { NextResponse } from "next/server"
import { randomBytes } from "crypto"
import bcrypt from "bcryptjs"
import { withAdminAuth } from "@/lib/api-wrapper"
import { prisma } from "@/lib/prisma/client"
import { sendEmail } from "@/lib/mail"
import { invitationEmail } from "@/lib/email"
import { fireEventRule } from "@/lib/fire-event-rule"
import { membreCreateSchema } from "@/lib/schemas"
import { parsePagination } from "@/lib/pagination"
import { writeActivityLog } from "@/lib/activity-log"
import { APP_URL } from "@/lib/env"
import { assertMemberLimit, MemberLimitReachedError, resolveDocumentBranding } from "@/lib/plan-limits"
import { currentCotisationYear, isMembreAdherent, membreAdherentCotisationSelect, membreAdherentResponsableSelect, membreAdherentWhereClause } from "@/lib/membre-adherent"
import { maybeCreateDefaultCotisation } from "@/lib/cotisation-defaults"
import { eligibleReceiptAmount } from "@/lib/receipt-eligibility"
import { parseModules } from "@/lib/modules"
import { addMonths } from "date-fns"
import { pusherServer } from "@/lib/pusher-server"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

// Même seuil que /api/membres/stats/route.ts pour bucketer "adulte" à partir de birthDate.
const ADULT_AGE_YEARS = 18

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx

  const { searchParams } = new URL(req.url)
  const search      = searchParams.get("search")?.trim()
  const status      = searchParams.get("status") ?? undefined
  const typeId      = searchParams.get("typeId") ?? undefined
  const adultsOnly  = searchParams.get("adultsOnly") === "true"
  const excludeId   = searchParams.get("excludeId") ?? undefined
  const adherent    = searchParams.get("adherent") ?? undefined // "ADHERENT" | "BENEVOLE"
  // Per-field filters, cumulative with `search` and with each other. `search` stays a single
  // OR across firstName/lastName/email (it answers "find this person"); these answer "give me
  // this subset of members", which is a different question and must narrow, never widen.
  const firstName = searchParams.get("firstName")?.trim()
  const lastName  = searchParams.get("lastName")?.trim()
  const address   = searchParams.get("address")?.trim()

  const where: Record<string, unknown> = { associationId, deletedAt: null }
  if (status) where.status = status
  if (typeId) where.typeId = typeId
  if (excludeId) where.id = { not: excludeId }
  if (firstName) where.firstName = { contains: firstName, mode: "insensitive" }
  if (lastName)  where.lastName  = { contains: lastName,  mode: "insensitive" }
  if (address)   where.address   = { contains: address,   mode: "insensitive" }
  if (search) {
    where.OR = [
      { firstName: { contains: search, mode: "insensitive" } },
      { lastName:  { contains: search, mode: "insensitive" } },
      { email:     { contains: search, mode: "insensitive" } },
    ]
  }

  // Every clause that targets birthDate goes through AND rather than a single where.birthDate:
  // adultsOnly (member picker) and the birth-date range (members list) can both be present,
  // and assigning where.birthDate twice would silently drop the first one.
  const and: Record<string, unknown>[] = []
  if (adultsOnly) {
    const adultCutoff = new Date()
    adultCutoff.setFullYear(adultCutoff.getFullYear() - ADULT_AGE_YEARS)
    and.push({ birthDate: { not: null, lte: adultCutoff } })
  }
  for (const [param, bound] of [["birthDateFrom", "gte"], ["birthDateTo", "lte"]] as const) {
    const raw = searchParams.get(param)?.trim()
    // Ignored rather than 422'd on a malformed value: an unparseable date would reach Prisma
    // as Invalid Date and blow up the whole list for what is only ever a filter.
    if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) continue
    // Bounds cover the whole calendar day in UTC — birthDate is stored anchored at noon UTC
    // (see the POST below), so a day-wide window matches it whichever end is queried.
    and.push({ birthDate: bound === "gte" ? { gte: new Date(`${raw}T00:00:00.000Z`) } : { lte: new Date(`${raw}T23:59:59.999Z`) } })
  }
  if (adherent === "ADHERENT" || adherent === "BENEVOLE") {
    and.push(membreAdherentWhereClause(adherent === "ADHERENT"))
  }
  if (and.length) where.AND = and

  // Ordre de la liste. Par défaut alphabétique ; "recent"/"oldest" trient sur joinedAt —
  // la date affichée dans la colonne « Membre depuis », pour que l'ordre à l'écran soit
  // lisible dans le tableau lui-même (createdAt donnerait un ordre que rien n'explique).
  // Le nom reste en départage : sans lui, deux membres inscrits le même jour peuvent
  // s'échanger de place d'une page à l'autre et un membre disparaît de la pagination.
  const sort    = searchParams.get("sort") ?? undefined
  const byName  = [{ lastName: "asc" as const }, { firstName: "asc" as const }]
  const orderBy = sort === "recent" ? [{ joinedAt: "desc" as const }, ...byName]
    : sort === "oldest"             ? [{ joinedAt: "asc"  as const }, ...byName]
    : byName

  const include = {
    type:        { select: { id: true, name: true, color: true } },
    user:        { select: { role: true } },
    cotisations: membreAdherentCotisationSelect(),
    responsable: membreAdherentResponsableSelect(),
  }

  if (!searchParams.has("page")) {
    const data = await prisma.membre.findMany({ where, orderBy, include, take: 500 })
    return NextResponse.json(data.map(m => ({ ...m, isAdherent: isMembreAdherent(m) })))
  }

  const { page, limit, skip } = parsePagination(searchParams)
  const [data, total, pendingCount] = await Promise.all([
    prisma.membre.findMany({ where, orderBy, skip, take: limit, include }),
    prisma.membre.count({ where }),
    // Deliberately ignores `where` — this is an inbox counter ("you have N requests waiting"),
    // so it must read the same however the list happens to be filtered or searched. Filtering
    // it would make the badge vanish the moment an admin narrowed the list, which is exactly
    // when they'd want to still see there is something to review.
    prisma.membre.count({ where: { associationId, deletedAt: null, status: "PENDING" } }),
  ])
  return NextResponse.json({ data: data.map(m => ({ ...m, isAdherent: isMembreAdherent(m) })), total, pendingCount, page, limit, totalPages: Math.ceil(total / limit) })
}, { roles: MANAGERS })

export const POST = withAdminAuth(async (req, ctx) => {
  const { associationId, role: actorRole, userId } = ctx

  const body = await req.json()
  const parsed = membreCreateSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })
  }

  // adherentOverride is intentionally dropped here (not spread into rest): a new member
  // always starts "automatic" (bénévole until a cotisation is paid) — the override is only
  // settable afterwards, via PATCH.
  const { birthDate, email, phone, address, typeId, civilite, sexe, groupeSanguin, allergies, spokenLanguage, possedeTshirt, tailleTshirt, responsableId, role = "MEMBRE", adherentOverride: _adherentOverride, tierId, ...rest } = parsed.data

  if (role === "ADMIN" && actorRole !== "ADMIN") {
    return NextResponse.json({ error: "Seul un administrateur peut attribuer le rôle admin" }, { status: 403 })
  }

  if (responsableId) {
    // Guards against a stale client and cross-tenant ids — same reasoning as the PATCH
    // route's check (see src/app/api/membres/[id]/route.ts).
    const responsableExists = await prisma.membre.findFirst({
      where:  { id: responsableId, associationId, deletedAt: null },
      select: { id: true },
    })
    if (!responsableExists) {
      return NextResponse.json({ error: "Membre responsable introuvable" }, { status: 422 })
    }
  }

  try {
    await assertMemberLimit(associationId)
  } catch (err) {
    if (err instanceof MemberLimitReachedError) return NextResponse.json({ error: err.message, code: err.code }, { status: 422 })
    throw err
  }

  const assoc = await prisma.association.findUnique({
    where:  { id: associationId },
    select: { name: true, slug: true, modules: true, plan: true, customBrandingEnabled: true, logoUrl: true, cotisationDefaultAmount: true },
  })

  const membreData = {
    ...rest,
    associationId,
    email:         email         || null,
    phone:         phone         || null,
    address:       address       || null,
    typeId:        typeId        || null,
    civilite:      civilite      || null,
    sexe:          sexe          || null,
    groupeSanguin: groupeSanguin || null,
    allergies:     allergies     || null,
    spokenLanguage: spokenLanguage || null,
    // Never persist "does not have a t-shirt" alongside a size (see membre-form.tsx's
    // matching reactive clear on the client — this is the server-side backstop).
    possedeTshirt: possedeTshirt === undefined || possedeTshirt === "" ? null : possedeTshirt === "true",
    tailleTshirt:  possedeTshirt === "false" ? null : (tailleTshirt || null),
    responsableId: responsableId || null,
    birthDate: birthDate ? new Date(birthDate + "T12:00:00") : null,
  }

  const existing = await prisma.user.findFirst({ where: { email: email.toLowerCase(), associationId } })
  if (existing) {
    return NextResponse.json({ error: "Un compte existe déjà avec cet email dans cette association" }, { status: 409 })
  }

  // Same eligibility rules as GET /api/membership-forms/tier-options (the picker this comes
  // from) — re-checked here rather than trusting the client, and scoped to this association.
  const tier = tierId
    ? await prisma.membershipTier.findFirst({
        where: {
          id:         tierId,
          itemType:   "MEMBERSHIP",
          kind:       "ONE_OFF",
          free:       false,
          freeAmount: false,
          amount:     { not: null },
          form:       { associationId, status: "PUBLISHED" },
        },
        select: {
          id: true, formId: true, amount: true, receiptMode: true, ineligibleAmount: true,
          durationMonths: true, fixedPeriodEnd: true, membreTypeId: true,
        },
      })
    : null
  if (tierId && (!tier || !assoc || !parseModules(assoc.modules).cotisations)) {
    return NextResponse.json({ error: "Tarif d'adhésion introuvable" }, { status: 422 })
  }

  const plainPassword = randomBytes(6).toString("hex")
  const passwordHash  = await bcrypt.hash(plainPassword, 12)

  const { membre, cotisation } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email:         email.toLowerCase(),
        name:          `${rest.firstName} ${rest.lastName}`,
        passwordHash,
        role:          role as "ADMIN" | "PRESIDENT" | "TRESORIER" | "SECRETAIRE" | "MEMBRE",
        associationId,
      },
    })
    const created = await tx.membre.create({ data: {
      ...membreData,
      // Same auto-tagging as the public form: the tarif's membreType wins only when the
      // admin didn't pick a type explicitly in the form.
      typeId: membreData.typeId ?? tier?.membreTypeId ?? null,
      userId: user.id,
    } })
    // No findPendingCotisation lookup here on purpose: unlike portal/register/route.ts,
    // this route always creates a brand-new Membre row (no re-link to a pre-existing one),
    // so created.id can never already have a cotisation — maybeCreateDefaultCotisation's own
    // return value is already the complete answer.
    if (!tier) {
      const cotisation = assoc ? await maybeCreateDefaultCotisation(tx, created.id, associationId, assoc) : null
      return { membre: created, cotisation }
    }
    // Cotisation snapshot mirroring the public form's offline branch (see
    // api/public/[slug]/adhesion/[formSlug]/checkout/route.ts) — the member registered by
    // the admin ends up indistinguishable from one who signed up on the form and hasn't
    // paid yet; the payment link emailed below settles it through the same Stripe webhook.
    const now         = new Date()
    const periodStart = tier.fixedPeriodEnd || tier.durationMonths ? now : null
    const periodEnd   = tier.fixedPeriodEnd ?? (tier.durationMonths ? addMonths(now, tier.durationMonths) : null)
    const cotisation  = await tx.cotisation.create({
      data: {
        membreId: created.id, associationId, year: currentCotisationYear(now),
        amount: tier.amount!, status: "EN_ATTENTE",
        membershipFormId: tier.formId, tierId: tier.id,
        periodStart, periodEnd, receiptMode: tier.receiptMode,
        deductibleAmount: eligibleReceiptAmount(Number(tier.amount), tier.receiptMode, tier.ineligibleAmount != null ? Number(tier.ineligibleAmount) : null),
        paymentToken: randomBytes(20).toString("hex"),
      },
      select: { amount: true, year: true, paymentToken: true },
    })
    return { membre: created, cotisation }
  })

  if (assoc) {
    const isStaff  = role !== "MEMBRE"
    const loginUrl = isStaff
      ? `${APP_URL}/login`
      : `${APP_URL}/portal/${assoc.slug}/login`

    // Staff (SECRETAIRE/TRESORIER/PRESIDENT/ADMIN) are invited to help run the association,
    // not as dues-paying members — and they log in to the admin dashboard, not the member
    // portal the cotisation note/link below points to. Surfacing "you owe money" in their
    // onboarding email, and a bell notification that dumps them into a portal they may never
    // otherwise touch, would be a surprising non-sequitur. The underlying cotisation record
    // (if any) is still created same as before; only the proactive nudge is MEMBRE-only.
    const notifyCotisation = !isStaff ? cotisation : null

    sendEmail(invitationEmail({
      firstName:       membre.firstName,
      email:           email.toLowerCase(),
      password:        plainPassword,
      associationName: assoc.name,
      role,
      loginUrl,
      branding:        resolveDocumentBranding(assoc),
      cotisation:      notifyCotisation ? {
        amount: Number(notifyCotisation.amount),
        year:   notifyCotisation.year,
        // Public pay-without-login link — the whole point of the admin-creates-member flow:
        // the admin fills everything in here, the member only has to pay on their side.
        payUrl: notifyCotisation.paymentToken ? `${APP_URL}/cotisation/${notifyCotisation.paymentToken}` : undefined,
      } : undefined,
    }), { associationId, membreId: membre.id, source: "MEMBER_INVITE" }).catch(() => {})

    // Same in-app notification pattern as new events/actualités/sondages — otherwise this
    // sits silently on the member's Cotisation tab until they think to check it themselves.
    if (notifyCotisation && membre.userId) {
      prisma.notification.create({
        data: {
          userId: membre.userId,
          title:  "Cotisation à régler",
          body:   `Votre cotisation ${notifyCotisation.year} de ${Number(notifyCotisation.amount).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })} est en attente de paiement.`,
          link:   `/portal/${assoc.slug}/cotisation`,
        },
      })
        .then(() => pusherServer.trigger(`private-association-${associationId}`, "new-notification", {}))
        .catch(() => {})
    }

    if (role === "MEMBRE") {
      fireEventRule({
        triggerType:   "MEMBER_CREATED",
        associationId,
        association:   { name: assoc.name, slug: assoc.slug, modules: assoc.modules, plan: assoc.plan, customBrandingEnabled: assoc.customBrandingEnabled, logoUrl: assoc.logoUrl },
        membre:        { id: membre.id, firstName: membre.firstName, lastName: membre.lastName, email: membre.email, phone: membre.phone },
      }).catch(() => {})
    }
  }

  await writeActivityLog({ associationId, actorId: userId, action: "MEMBRE_CREATED", entity: "Membre", entityId: membre.id, label: `${membre.firstName} ${membre.lastName}` })

  return NextResponse.json(membre, { status: 201 })
}, { roles: MANAGERS })
