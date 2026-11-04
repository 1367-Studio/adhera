import type { McpServer } from "@modelcontextprotocol/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { getPricingInfo, customerHasPaymentMethod } from "@/lib/stripe"
import { planLabel } from "@/lib/plan-tier"
import { parseModules } from "@/lib/modules"
import { validateOfferPhases, type OfferPhase } from "@/lib/pricing-offers"
import {
  DAY_MS,
  centsToEuros,
  daysAgo,
  daysUntil,
  decimalToEuros,
  isTicketUnreadForStaff,
  jsonToolResult,
  summarizeMrr,
  toIsoOrNull,
} from "@/lib/admin-mcp/format"

// READ-ONLY by construction: every call below is findMany/findFirst/count/groupBy/aggregate
// on Prisma, plus two read-only Stripe helpers already used by the backoffice
// (getPricingInfo → prices.retrieve, customerHasPaymentMethod → customers/subscriptions
// .retrieve). Nothing here writes to the DB, Stripe or sends email. Cross-tenant on purpose
// (founder tool) — but member personal data only ever leaves as counts, and secrets
// (passwordHash, 2FA, API keys, IBAN, Stripe ids) are never selected.

const DEFAULT_LIST_LIMIT = 25
const MAX_LIST_LIMIT     = 100
// Each payment-method check is 1–2 Stripe API calls; cap them per tool call.
const MAX_PAYMENT_METHOD_CHECKS = 25

const limitSchema = z.number().int().min(1).max(MAX_LIST_LIMIT).default(DEFAULT_LIST_LIMIT)
  .describe(`Max rows to return (default ${DEFAULT_LIST_LIMIT}, max ${MAX_LIST_LIMIT})`)

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint:    true,
  destructiveHint: false,
  idempotentHint:  true,
  openWorldHint:   false,
} as const

// The association's founding admin (role ADMIN, created by /api/register) — oldest ADMIN wins.
const SIGNUP_ADMIN_SELECT = {
  where:   { role: "ADMIN" as const, deletedAt: null },
  orderBy: { createdAt: "asc" as const },
  take:    1,
  select:  { name: true, email: true },
}

const LIVE_MEMBER_COUNT = { _count: { select: { membres: { where: { deletedAt: null } } } } }

function parseOfferPhases(rawPhases: unknown): OfferPhase[] | null {
  return validateOfferPhases(rawPhases) ? rawPhases : null
}

// Yearly catalog price amounts, used only to tell a yearly subscription apart from a monthly
// one for MRR. Same cached Stripe price lookup the backoffice association page already does;
// null (MRR falls back to the period-length heuristic) if Stripe can't be reached.
async function loadYearlyCatalogAmounts(): Promise<Set<number> | null> {
  try {
    const pricing = await getPricingInfo()
    return new Set(Object.values(pricing.plans).map(planPricing => planPricing.yearlyAmountCents).filter(amount => amount > 0))
  } catch {
    return null
  }
}

function summarizeAssociationRow(association: {
  id: string
  name: string
  slug: string
  city: string | null
  plan: Parameters<typeof planLabel>[0]
  subscriptionStatus: string
  subscriptionAmountCents: number | null
  trialEndsAt: Date | null
  createdAt: Date
  deletedAt?: Date | null
  users: { name: string | null; email: string }[]
  _count: { membres: number }
}) {
  const signupAdmin = association.users[0]
  return {
    id:                      association.id,
    name:                    association.name,
    slug:                    association.slug,
    city:                    association.city,
    plan:                    planLabel(association.plan),
    subscriptionStatus:      association.subscriptionStatus,
    subscriptionAmountEuros: association.subscriptionAmountCents === null ? null : centsToEuros(association.subscriptionAmountCents),
    trialEndsAt:             toIsoOrNull(association.trialEndsAt),
    createdAt:               association.createdAt.toISOString(),
    ...(association.deletedAt !== undefined ? { deletedAt: toIsoOrNull(association.deletedAt) } : {}),
    adminName:               signupAdmin?.name ?? null,
    adminEmail:              signupAdmin?.email ?? null,
    memberCount:             association._count.membres,
  }
}

const ASSOCIATION_ROW_SELECT = {
  id:                      true,
  name:                    true,
  slug:                    true,
  city:                    true,
  plan:                    true,
  subscriptionStatus:      true,
  subscriptionAmountCents: true,
  trialEndsAt:             true,
  createdAt:               true,
  users:                   SIGNUP_ADMIN_SELECT,
  ...LIVE_MEMBER_COUNT,
} as const

// ---------------------------------------------------------------------------------------

async function getOverview() {
  const now = new Date()
  const liveAssociation = { deletedAt: null }

  const [
    statusGroups,
    planGroups,
    totalAssociations,
    newLast7Days,
    newLast30Days,
    trialsEndingNext7Days,
    trialsPastEndDate,
    billingRows,
    totalMembers,
    openSupportTickets,
    yearlyCatalogAmounts,
  ] = await Promise.all([
    prisma.association.groupBy({ by: ["subscriptionStatus"], where: liveAssociation, _count: { _all: true } }),
    prisma.association.groupBy({ by: ["plan"], where: liveAssociation, _count: { _all: true } }),
    prisma.association.count({ where: liveAssociation }),
    prisma.association.count({ where: { ...liveAssociation, createdAt: { gte: daysAgo(7, now) } } }),
    prisma.association.count({ where: { ...liveAssociation, createdAt: { gte: daysAgo(30, now) } } }),
    prisma.association.count({
      where: { ...liveAssociation, subscriptionStatus: "TRIAL", trialEndsAt: { gte: now, lte: new Date(now.getTime() + 7 * DAY_MS) } },
    }),
    prisma.association.count({
      where: { ...liveAssociation, subscriptionStatus: "TRIAL", trialEndsAt: { lt: now } },
    }),
    prisma.association.findMany({
      where:  { ...liveAssociation, subscriptionStatus: { in: ["ACTIVE", "PAST_DUE"] } },
      select: {
        subscriptionStatus:      true,
        subscriptionAmountCents: true,
        currentPeriodEndsAt:     true,
        pricingOffer:            { select: { phases: true } },
      },
    }),
    prisma.membre.count({ where: { deletedAt: null, association: liveAssociation } }),
    prisma.supportTicket.count({ where: { status: "OUVERT" } }),
    loadYearlyCatalogAmounts(),
  ])

  const mrr = summarizeMrr(
    billingRows.map(billingRow => ({
      subscriptionStatus:      billingRow.subscriptionStatus,
      subscriptionAmountCents: billingRow.subscriptionAmountCents,
      currentPeriodEndsAt:     billingRow.currentPeriodEndsAt,
      offerPhases:             parseOfferPhases(billingRow.pricingOffer?.phases),
    })),
    yearlyCatalogAmounts,
    now,
  )

  return {
    generatedAt:             now.toISOString(),
    totalAssociations,
    associationsByStatus:    Object.fromEntries(statusGroups.map(group => [group.subscriptionStatus, group._count._all])),
    associationsByPlan:      Object.fromEntries(planGroups.map(group => [planLabel(group.plan), group._count._all])),
    newAssociationsLast7Days:  newLast7Days,
    newAssociationsLast30Days: newLast30Days,
    trialsEndingNext7Days,
    trialsPastEndDateStillTrial: trialsPastEndDate,
    mrr: {
      ...mrr,
      definition: "Sum of ACTIVE associations' subscriptionAmountCents (> 0), normalized to a monthly amount (yearly / multi-month offer phases spread). Excludes TRIAL, PAST_DUE (shown separately), 0€ offers. Not Stripe net revenue.",
    },
    totalMembers,
    openSupportTickets,
  }
}

async function listSignups(sinceDays: number, limit: number) {
  const now = new Date()
  const where = { deletedAt: null, createdAt: { gte: daysAgo(sinceDays, now) } }
  const [totalInWindow, associations] = await Promise.all([
    prisma.association.count({ where }),
    prisma.association.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take:    limit,
      select:  ASSOCIATION_ROW_SELECT,
    }),
  ])
  return {
    sinceDays,
    totalInWindow,
    returned:     associations.length,
    associations: associations.map(summarizeAssociationRow),
  }
}

async function listTrials(endingWithinDays: number | undefined, limit: number, checkPaymentMethod: boolean) {
  const now = new Date()
  const where = {
    deletedAt:          null,
    subscriptionStatus: "TRIAL" as const,
    ...(endingWithinDays !== undefined ? { trialEndsAt: { lte: new Date(now.getTime() + endingWithinDays * DAY_MS) } } : {}),
  }
  const [totalTrials, associations] = await Promise.all([
    prisma.association.count({ where }),
    prisma.association.findMany({
      where,
      orderBy: { trialEndsAt: { sort: "asc", nulls: "last" } },
      take:    limit,
      select:  {
        ...ASSOCIATION_ROW_SELECT,
        // Only used to derive booleans below — never returned as-is.
        stripeCustomerId:     true,
        stripeSubscriptionId: true,
        pricingOffer:         { select: { label: true, phases: true } },
      },
    }),
  ])

  const trials = await Promise.all(associations.map(async (association, index) => {
    let hasPaymentMethod: boolean | null = null
    if (checkPaymentMethod && index < MAX_PAYMENT_METHOD_CHECKS && association.stripeCustomerId) {
      hasPaymentMethod = await customerHasPaymentMethod(association.stripeCustomerId, association.stripeSubscriptionId)
        .catch(() => null)
    }
    const offerPhases = parseOfferPhases(association.pricingOffer?.phases)
    return {
      ...summarizeAssociationRow(association),
      daysLeft:              association.trialEndsAt ? daysUntil(association.trialEndsAt, now) : null,
      hasStripeCustomer:     association.stripeCustomerId !== null,
      hasStripeSubscription: association.stripeSubscriptionId !== null,
      // null = not checked (no Stripe customer, check disabled, beyond the check cap, or Stripe error)
      hasPaymentMethod,
      pricingOffer:          association.pricingOffer
        ? { label: association.pricingOffer.label, phases: offerPhases?.map(phase => ({ amountEuros: centsToEuros(phase.amountCents), months: phase.months })) ?? null }
        : null,
    }
  }))

  return {
    endingWithinDays: endingWithinDays ?? null,
    totalTrials,
    returned: trials.length,
    note:     "Trial signups collect no card: without a payment method Stripe cancels the subscription at trial end.",
    trials,
  }
}

async function searchAssociations(query: string, limit: number) {
  const contains = { contains: query, mode: "insensitive" as const }
  const associations = await prisma.association.findMany({
    where: {
      OR: [
        { name: contains },
        { slug: contains },
        { city: contains },
        { users: { some: { role: "ADMIN", deletedAt: null, email: contains } } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take:    limit,
    select:  { ...ASSOCIATION_ROW_SELECT, deletedAt: true },
  })
  return { query, returned: associations.length, associations: associations.map(summarizeAssociationRow) }
}

async function getAssociation(idOrSlug: string) {
  const association = await prisma.association.findFirst({
    where:  { OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    select: {
      id: true, name: true, slug: true, city: true, country: true,
      organismeCategory: true, contactEmail: true, website: true,
      plan: true, subscriptionStatus: true, subscriptionAmountCents: true,
      trialEndsAt: true, trialExpiredAt: true, suspendedAt: true, cancelAtPeriodEnd: true,
      currentPeriodEndsAt: true, subscriptionGracePeriodEndsAt: true,
      customMemberLimit: true, customBrandingEnabled: true,
      // Only turned into booleans below — the ids themselves are never returned.
      stripeCustomerId: true, stripeSubscriptionId: true, stripeConnectId: true,
      sitePublished: true, customDomain: true, customDomainStatus: true,
      modules: true, internalNotes: true, createdAt: true, deletedAt: true,
      pricingOffer: { select: { label: true, status: true, phases: true, usedAt: true } },
      users: {
        where:   { deletedAt: null, role: { notIn: ["MEMBRE", "SUPER_ADMIN"] } },
        orderBy: { createdAt: "asc" },
        select:  { name: true, email: true, role: true, lastLoginAt: true, lastSeenAt: true },
      },
    },
  })
  if (!association) return null

  const associationId = association.id
  const [
    membersByStatus,
    evenementCount,
    cotisationCount,
    cotisationsFullyPaid,
    cotisationsPartiallyPaid,
    paidDons,
    supportTicketsByStatus,
    lastActivity,
  ] = await Promise.all([
    prisma.membre.groupBy({ by: ["status"], where: { associationId, deletedAt: null }, _count: { _all: true } }),
    prisma.evenement.count({ where: { associationId } }),
    prisma.cotisation.count({ where: { associationId } }),
    // "Collected" mirrors the dashboard's cotisationsEncaissees (src/app/api/dashboard/route.ts):
    // full amount of PAYE + amountPaid of partially-paid/late ones — here across all years.
    prisma.cotisation.aggregate({ where: { associationId, status: "PAYE" }, _sum: { amount: true } }),
    prisma.cotisation.aggregate({
      where: { associationId, status: { in: ["PARTIELLEMENT_PAYEE", "EN_RETARD"] } },
      _sum:  { amountPaid: true },
    }),
    prisma.don.aggregate({ where: { associationId, paidAt: { not: null } }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.supportTicket.groupBy({ by: ["status"], where: { associationId }, _count: { _all: true } }),
    prisma.activityLog.findFirst({
      where:   { associationId },
      orderBy: { createdAt: "desc" },
      select:  { createdAt: true, action: true },
    }),
  ])

  const staffLastSeenAt = association.users.reduce<Date | null>(
    (latest, staffUser) => staffUser.lastSeenAt && (!latest || staffUser.lastSeenAt > latest) ? staffUser.lastSeenAt : latest,
    null,
  )
  const enabledModules = Object.entries(parseModules(association.modules))
    .filter(([, isEnabled]) => isEnabled)
    .map(([moduleKey]) => moduleKey)
  const offerPhases = parseOfferPhases(association.pricingOffer?.phases)
  const membersByStatusRecord = Object.fromEntries(membersByStatus.map(group => [group.status, group._count._all]))

  return {
    id:                association.id,
    name:              association.name,
    slug:              association.slug,
    city:              association.city,
    country:           association.country,
    organismeCategory: association.organismeCategory,
    contactEmail:      association.contactEmail,
    website:           association.website,
    createdAt:         association.createdAt.toISOString(),
    deletedAt:         toIsoOrNull(association.deletedAt),
    billing: {
      plan:                          planLabel(association.plan),
      subscriptionStatus:            association.subscriptionStatus,
      subscriptionAmountEuros:       association.subscriptionAmountCents === null ? null : centsToEuros(association.subscriptionAmountCents),
      trialEndsAt:                   toIsoOrNull(association.trialEndsAt),
      trialDaysLeft:                 association.subscriptionStatus === "TRIAL" && association.trialEndsAt ? daysUntil(association.trialEndsAt, new Date()) : null,
      trialExpiredAt:                toIsoOrNull(association.trialExpiredAt),
      suspendedAt:                   toIsoOrNull(association.suspendedAt),
      cancelAtPeriodEnd:             association.cancelAtPeriodEnd,
      currentPeriodEndsAt:           toIsoOrNull(association.currentPeriodEndsAt),
      subscriptionGracePeriodEndsAt: toIsoOrNull(association.subscriptionGracePeriodEndsAt),
      customMemberLimit:             association.customMemberLimit,
      customBrandingEnabled:         association.customBrandingEnabled,
      hasStripeCustomer:             association.stripeCustomerId !== null,
      hasStripeSubscription:         association.stripeSubscriptionId !== null,
      stripeConnectLinked:           association.stripeConnectId !== null,
      pricingOffer:                  association.pricingOffer
        ? {
            label:  association.pricingOffer.label,
            status: association.pricingOffer.status,
            usedAt: toIsoOrNull(association.pricingOffer.usedAt),
            phases: offerPhases?.map(phase => ({ amountEuros: centsToEuros(phase.amountCents), months: phase.months })) ?? null,
          }
        : null,
    },
    site: {
      published:          association.sitePublished,
      customDomain:       association.customDomain,
      customDomainStatus: association.customDomainStatus,
    },
    enabledModules,
    internalNotes: association.internalNotes,
    staff: association.users.map(staffUser => ({
      name:        staffUser.name,
      email:       staffUser.email,
      role:        staffUser.role,
      lastLoginAt: toIsoOrNull(staffUser.lastLoginAt),
      lastSeenAt:  toIsoOrNull(staffUser.lastSeenAt),
    })),
    counts: {
      membersTotal:          Object.values(membersByStatusRecord).reduce((total, count) => total + count, 0),
      membersByStatus:       membersByStatusRecord,
      evenements:            evenementCount,
      cotisations:           cotisationCount,
      cotisationsCollectedEuros:
        decimalToEuros(cotisationsFullyPaid._sum.amount) + decimalToEuros(cotisationsPartiallyPaid._sum.amountPaid),
      donsPaidCount:         paidDons._count._all,
      donsPaidTotalEuros:    decimalToEuros(paidDons._sum.amount),
      supportTicketsByStatus: Object.fromEntries(supportTicketsByStatus.map(group => [group.status, group._count._all])),
    },
    lastActivityLogAt:     toIsoOrNull(lastActivity?.createdAt),
    lastActivityLogAction: lastActivity?.action ?? null,
    staffLastSeenAt:       toIsoOrNull(staffLastSeenAt),
  }
}

async function listSupportTickets(status: "OUVERT" | "FERME" | undefined, limit: number) {
  const where = status ? { status } : {}
  const [totalMatching, tickets] = await Promise.all([
    prisma.supportTicket.count({ where }),
    prisma.supportTicket.findMany({
      where,
      orderBy: { lastMessageAt: "desc" },
      take:    limit,
      select:  {
        id: true, subject: true, status: true, createdAt: true,
        lastMessageAt: true, lastMessageAuthorRole: true, readByStaffAt: true,
        association: { select: { name: true, slug: true } },
        author:      { select: { name: true, email: true } },
        _count:      { select: { messages: true } },
      },
    }),
  ])
  return {
    status: status ?? "ALL",
    totalMatching,
    returned: tickets.length,
    tickets: tickets.map(ticket => ({
      id:                    ticket.id,
      subject:               ticket.subject,
      status:                ticket.status,
      associationName:       ticket.association.name,
      associationSlug:       ticket.association.slug,
      authorName:            ticket.author.name,
      authorEmail:           ticket.author.email,
      messageCount:          ticket._count.messages,
      createdAt:             ticket.createdAt.toISOString(),
      lastMessageAt:         ticket.lastMessageAt.toISOString(),
      lastMessageFrom:       ticket.lastMessageAuthorRole === "SUPER_ADMIN" ? "staff" : "association",
      unreadByStaff:         isTicketUnreadForStaff(ticket),
    })),
  }
}

async function listRecentActivity(action: string | undefined, sinceDays: number, limit: number) {
  const where = {
    createdAt: { gte: daysAgo(sinceDays, new Date()) },
    ...(action ? { action } : {}),
  }
  const [totalInWindow, actionGroups, activityRows] = await Promise.all([
    prisma.activityLog.count({ where }),
    prisma.activityLog.groupBy({ by: ["action"], where, _count: { _all: true } }),
    prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take:    limit,
      // metadata deliberately not selected: it holds free-form diffs that may include
      // sensitive values (see computeAssociationDiff in src/lib/activity-log.ts).
      select:  {
        action: true, entity: true, label: true, createdAt: true,
        association: { select: { name: true, slug: true } },
      },
    }),
  ])
  const countsByAction = Object.fromEntries(
    actionGroups
      .map(group => [group.action, group._count._all] as const)
      .sort(([, firstCount], [, secondCount]) => secondCount - firstCount),
  )
  return {
    sinceDays,
    action: action ?? null,
    totalInWindow,
    countsByAction,
    returned: activityRows.length,
    activity: activityRows.map(activityRow => ({
      action:          activityRow.action,
      entity:          activityRow.entity,
      label:           activityRow.label,
      associationName: activityRow.association.name,
      associationSlug: activityRow.association.slug,
      createdAt:       activityRow.createdAt.toISOString(),
    })),
  }
}

// ---------------------------------------------------------------------------------------

export function registerAdminTools(server: McpServer) {
  server.registerTool(
    "get_overview",
    {
      title:       "Formwise overview",
      description: "Platform-wide snapshot: associations by subscription status and plan, new sign-ups (7/30 days), trials ending in the next 7 days, MRR/ARR estimate (EUR), total members, open support tickets.",
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async () => jsonToolResult(await getOverview()),
  )

  server.registerTool(
    "list_signups",
    {
      title:       "Recent association sign-ups",
      description: "Associations created in the last N days, newest first: name, slug, city, plan, subscription status, trial end, creation date, signup admin name/email, member count.",
      inputSchema: z.object({
        sinceDays: z.number().int().min(1).max(365).default(30).describe("Look-back window in days (default 30)"),
        limit:     limitSchema,
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ sinceDays, limit }) => jsonToolResult(await listSignups(sinceDays, limit)),
  )

  server.registerTool(
    "list_trials",
    {
      title:       "Associations on trial",
      description: "Associations currently in TRIAL, soonest trial end first, with days left, admin email, Stripe customer/subscription presence and (Stripe read-only check, first 25 rows) whether a payment method is on file.",
      inputSchema: z.object({
        endingWithinDays:   z.number().int().min(0).max(365).optional().describe("Only trials ending within this many days (includes already-overdue trials)"),
        limit:              limitSchema,
        checkPaymentMethod: z.boolean().default(true).describe("Ask Stripe (read-only) whether a card is on file; default true"),
      }),
      annotations: { ...READ_ONLY_ANNOTATIONS, openWorldHint: true },
    },
    async ({ endingWithinDays, limit, checkPaymentMethod }) => jsonToolResult(await listTrials(endingWithinDays, limit, checkPaymentMethod)),
  )

  server.registerTool(
    "search_associations",
    {
      title:       "Search associations",
      description: "Case-insensitive search of associations by name, slug, city or admin email (includes soft-deleted ones, flagged by deletedAt).",
      inputSchema: z.object({
        query: z.string().trim().min(2).max(100).describe("Text to search for"),
        limit: limitSchema,
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ query, limit }) => jsonToolResult(await searchAssociations(query, limit)),
  )

  server.registerTool(
    "get_association",
    {
      title:       "Association details",
      description: "Full picture of one association by id or slug: billing/plan fields, pricing offer, site, enabled modules, staff accounts, counts (members by status, events, cotisations + collected EUR, paid dons, support tickets), last activity.",
      inputSchema: z.object({
        idOrSlug: z.string().trim().min(1).max(200).describe("Association id (cuid) or slug"),
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ idOrSlug }) => {
      const association = await getAssociation(idOrSlug)
      if (!association) {
        return { ...jsonToolResult({ error: `No association found for "${idOrSlug}"` }), isError: true }
      }
      return jsonToolResult(association)
    },
  )

  server.registerTool(
    "list_support_tickets",
    {
      title:       "Support tickets",
      description: "Support tickets across all associations, most recently active first (no message bodies): subject, status, association, author, message count, last message date and side, unread-by-staff flag.",
      inputSchema: z.object({
        status: z.enum(["OUVERT", "FERME"]).optional().describe("OUVERT = open, FERME = closed; omit for all"),
        limit:  limitSchema,
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ status, limit }) => jsonToolResult(await listSupportTickets(status, limit)),
  )

  server.registerTool(
    "list_recent_activity",
    {
      title:       "Recent activity log",
      description: "ActivityLog entries across all associations (action, entity, label, association, date), newest first, plus counts per action in the window. Metadata is never returned.",
      inputSchema: z.object({
        action:    z.string().trim().min(1).max(100).optional().describe("Exact action code to filter on, e.g. MEMBRE_CREATED"),
        sinceDays: z.number().int().min(1).max(365).default(7).describe("Look-back window in days (default 7)"),
        limit:     limitSchema,
      }),
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ action, sinceDays, limit }) => jsonToolResult(await listRecentActivity(action, sinceDays, limit)),
  )
}
