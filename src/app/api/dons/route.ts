import { NextResponse } from "next/server"
import { z } from "zod"
import { prisma } from "@/lib/prisma/client"
import { parsePagination } from "@/lib/pagination"
import { withAdminAuth } from "@/lib/api-wrapper"
import { writeActivityLog } from "@/lib/activity-log"
import { resolveExerciceForDate, resolveCurrentPeriod, exclusiveEndOfDay } from "@/lib/finance/exercice"
import { resolveEmailBranding } from "@/lib/plan-limits"
import { generateRecuFiscalForDon } from "@/lib/pdf/recu-fiscal"
import { sendEmail } from "@/lib/mail"
import { donConfirmationEmail } from "@/lib/email"
import { notifyDonResponsable } from "@/lib/dons/notify"
import { reportError } from "@/lib/monitoring"

// Same threshold as the dashboard Dons page's search boxes.
const MIN_SEARCH_LENGTH = 3

export const GET = withAdminAuth(async (req, ctx) => {
  const { associationId } = ctx
  const { searchParams } = new URL(req.url)

  const year          = searchParams.get("year")
  // Ignored under MIN_SEARCH_LENGTH characters (the dashboard doesn't send it either) — a
  // 1–2 letter `contains` scan across five columns matches nearly everything anyway.
  const rawSearch     = searchParams.get("search")?.trim() ?? ""
  const search        = rawSearch.length >= MIN_SEARCH_LENGTH ? rawSearch : undefined
  const origin        = searchParams.get("origin") ?? undefined
  const receiptsOnly  = searchParams.get("receiptsOnly") === "true"
  // Offline dons (espèces/chèque/virement) awaiting encaissement — the one other state
  // besides "paid" this table needs to surface, so an admin has somewhere to see and
  // action them. Mutually exclusive with receiptsOnly (a pending don has no receipt yet).
  const pendingOnly   = searchParams.get("pendingOnly") === "true"

  const where: Record<string, unknown> = pendingOnly
    ? { associationId, paidAt: null, paymentMethod: { in: ["ESPECES", "CHEQUE", "VIREMENT"] } }
    : {
        associationId,
        paidAt: { not: null },
        ...(receiptsOnly ? { receiptNumber: { not: null } } : {}),
      }

  // The current year gets the exercice-aware range (the association's exercice covering today,
  // else the plain calendar year) — same rule as Événements/Boutique, see resolveCurrentPeriod.
  // A year picked explicitly from the dropdown (anything else) stays plain calendar-year: there
  // is no reliable way to map a past exercice from just its label's leading year number.
  const currentYear = new Date().getFullYear()
  const period = await resolveCurrentPeriod(associationId)
  if (year && !pendingOnly) {
    const y = parseInt(year)
    if (!Number.isNaN(y)) {
      where.paidAt = y === currentYear
        ? { gte: period.startDate, lt: exclusiveEndOfDay(period.endDate) }
        : { gte: new Date(`${y}-01-01`), lt: new Date(`${y + 1}-01-01`) }
    }
  }

  if (search) {
    where.OR = [
      { firstName:   { contains: search, mode: "insensitive" } },
      { lastName:    { contains: search, mode: "insensitive" } },
      { companyName: { contains: search, mode: "insensitive" } },
      { email:       { contains: search, mode: "insensitive" } },
      { message:     { contains: search, mode: "insensitive" } },
    ]
  }

  // Plain field equality for every branch (never `where.OR`, unlike `search` above) so this
  // never collides with the free-text search — both can be active together, and
  // aggregateWhere's blind `delete aggregateWhere.OR` below only strips `search` from the KPI
  // totals, never this filter.
  if (origin === "form")            where.donationFormId       = { not: null }
  if (origin === "adhesion")        where.membershipAddonTierId = { not: null }
  if (origin === "evenementTicket") where.evenementTicketTypeId = { not: null }
  // The post-registration donation prompt (event-donation-prompt.tsx) sets evenementId
  // without evenementTicketTypeId — the `null` guard keeps this bucket exclusive of
  // evenementTicket above, since a ticket-embedded don never has evenementId set anyway (see
  // createEvenementDonation) but relying on that invariant here would be a silent trap.
  if (origin === "evenementPrompt") {
    where.evenementId           = { not: null }
    where.evenementTicketTypeId = null
  }
  if (origin === "standalone") {
    where.donationFormId        = null
    where.membershipAddonTierId = null
    where.evenementTicketTypeId = null
    where.evenementId           = null
    // Without this, a manually-typed don with no linked form (origin "manual" below) matched
    // this bucket too — donationFormId/membershipAddonTierId/evenementId are all null for it
    // just like a real standalone-page don, so it silently double-counted in both filters.
    where.createdByUserId       = null
  }
  // Admin-typed via the "add manual donation" form (POST below) — see Don.createdByUserId.
  if (origin === "manual") where.createdByUserId = { not: null }

  // Amount range in euros, either bound optional (the "Reçus fiscaux" tab filter). A plain
  // field condition like origin above, so the KPI totals keep following it too.
  const minAmount = parseFloat(searchParams.get("minAmount") ?? "")
  const maxAmount = parseFloat(searchParams.get("maxAmount") ?? "")
  if (!Number.isNaN(minAmount) || !Number.isNaN(maxAmount)) {
    where.amount = {
      ...(!Number.isNaN(minAmount) ? { gte: minAmount } : {}),
      ...(!Number.isNaN(maxAmount) ? { lte: maxAmount } : {}),
    }
  }

  // KPI totals intentionally ignore `search` — they summarize the year, not the filtered
  // list, so typing in the search box doesn't make the summary cards jump around. They also
  // exclude refunded dons even though the list below still shows them (Don.refundedAt is set by
  // the Stripe webhook on a refund, see stripe/route.ts — paidAt is never cleared, so without
  // this the total kept counting money that was given back).
  const aggregateWhere: Record<string, unknown> = { ...where, refundedAt: null }
  delete aggregateWhere.OR

  const orderBy = { paidAt: "desc" as const }

  const { page, limit, skip } = parsePagination(searchParams)
  const [data, total, aggregate] = await Promise.all([
    prisma.don.findMany({
      where, orderBy, skip, take: limit,
      include: {
        // customFields lets the admin table show what the donor answered (see the info
        // modal in dashboard/dons/page.tsx) — same convention as evenement.customFields
        // for Participation.answers.
        donationForm: { select: { id: true, title: true, customFields: { select: { id: true, type: true, label: true, options: true } } } },
        // Only set for a don embarqué on a MembershipForm signup (see Don.membershipAddonTierId)
        // — lets the pending-encaissement table point back at the member and the tier that
        // produced it, since that member also has an independent Cotisation pending its own
        // encaissement for the same physical payment (see checkout/route.ts's offline branch).
        membershipAddonTier: { select: { label: true } },
        // Set for a don embarqué on an event ticket type (Don.evenementTicketTypeId) — lets
        // the "origine" column point back at the event.
        evenementTicketType: { select: { evenement: { select: { id: true, title: true } } } },
        // Set for a don triggered by the post-registration donation prompt on an event
        // (Don.evenementId, see event-donation-prompt.tsx) — a different flow from the ticket
        // add-on above, but the same "came from an event" origin from an admin's viewpoint.
        evenement: { select: { id: true, title: true } },
        // Set only on a Don created through the manual-entry form below — see
        // Don.createdByUserId. Lets the "origine" column attribute it to the admin who
        // typed it, instead of looking like a normal donor-submitted donation.
        createdBy: { select: { name: true, email: true } },
      },
    }),
    prisma.don.count({ where }),
    prisma.don.aggregate({ where: aggregateWhere, _sum: { amount: true }, _count: { id: true } }),
  ])

  return NextResponse.json({
    data,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    totalAmount: Number(aggregate._sum.amount ?? 0),
    totalCount:  aggregate._count.id,
    // Only meaningful when the request's `year` is the current one — the dashboard shows a
    // period heading ("Exercice 2026" / "2026") above the KPI cards only in that case, see
    // resolveCurrentPeriod.
    period: { kind: period.kind, startYear: period.startYear, endYear: period.endYear },
  })
}, { area: "dons" })

const manualDonSchema = z.object({
  donorMode:        z.enum(["member", "external"]),
  membreId:         z.string().optional(),
  firstName:        z.string().trim().min(1).optional(),
  lastName:         z.string().trim().min(1).optional(),
  email:            z.string().trim().email().optional(),
  amount:           z.number().positive(),
  paidAt:           z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paymentMethod:    z.enum(["ESPECES", "CHEQUE", "VIREMENT", "AUTRE"]),
  donationFormId:   z.string().nullable().optional(),
  note:             z.string().trim().optional(),
  sendReceiptEmail: z.boolean(),
  notifyResponsible: z.boolean().optional().default(false),
}).refine(
  d => d.donorMode !== "member" || !!d.membreId,
  { message: "Contact requis", path: ["membreId"] },
).refine(
  d => d.donorMode !== "external" || (!!d.firstName && !!d.lastName),
  { message: "Nom et prénom requis", path: ["firstName"] },
)

// Records a donation already received in hand (cash/cheque/transfer/other) in one step —
// unlike the public offline flow (checkout → pending → admin "encaisser"), the admin here is
// the one attesting the money already arrived, so paidAt is set immediately and there is no
// intermediate pending state. Don.createdByUserId is what tells this apart from a
// donor-submitted donation an admin merely confirmed — see the field's comment in
// schema.prisma.
export const POST = withAdminAuth(async (req, ctx) => {
  const body   = await req.json().catch(() => null)
  const parsed = manualDonSchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 422 })
  const data = parsed.data

  let firstName: string
  let lastName:  string
  let email:     string
  let membreId:  string | null = null

  if (data.donorMode === "member") {
    const membre = await prisma.membre.findFirst({
      where:  { id: data.membreId, associationId: ctx.associationId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, email: true },
    })
    if (!membre) return NextResponse.json({ error: "Contact introuvable" }, { status: 404 })
    membreId  = membre.id
    firstName = membre.firstName
    lastName  = membre.lastName
    email     = membre.email ?? ""
  } else {
    firstName = data.firstName!
    lastName  = data.lastName!
    email     = data.email ?? ""
  }

  if (data.donationFormId) {
    const form = await prisma.donationForm.findFirst({
      where:  { id: data.donationFormId, associationId: ctx.associationId },
      select: { id: true },
    })
    if (!form) return NextResponse.json({ error: "Formulaire introuvable" }, { status: 404 })
  }

  // Anchored at noon UTC, same convention as Membre.birthDate — a date-only value stored at
  // UTC midnight would read back as the previous day for anyone west of Greenwich.
  const paidAt = new Date(`${data.paidAt}T12:00:00.000Z`)

  const don = await prisma.don.create({
    data: {
      associationId:   ctx.associationId,
      membreId,
      donorType:       "INDIVIDUAL",
      firstName,
      lastName,
      email,
      amount:          data.amount,
      message:         data.note || null,
      donationFormId:  data.donationFormId || null,
      paymentMethod:   data.paymentMethod,
      paidAt,
      createdByUserId: ctx.userId,
    },
  })

  const exercice = await resolveExerciceForDate(ctx.associationId, paidAt)
  await prisma.income.create({
    data: {
      associationId: ctx.associationId,
      exerciceId:    exercice?.status === "OUVERT" ? exercice.id : null,
      donId:         don.id,
      amount:        data.amount,
      description:   `Don de ${firstName} ${lastName}`,
      paymentMethod: data.paymentMethod,
      source:        "MANUAL",
      status:        "PAID",
      date:          paidAt,
    },
  })

  await writeActivityLog({
    associationId: ctx.associationId,
    actorId:       ctx.userId,
    action:        "DON_CREATED",
    entity:        "Don",
    entityId:      don.id,
    label:         `${firstName} ${lastName} — ${data.amount}€ (saisie manuelle, ${data.paymentMethod})`,
    metadata:      { amount: data.amount, paymentMethod: data.paymentMethod, manual: true },
  })

  if (data.sendReceiptEmail && email) {
    const assoc = await prisma.association.findUnique({
      where:  { id: ctx.associationId },
      select: { id: true, name: true, address: true, city: true, siren: true, rna: true, canIssueTaxReceipts: true, objet: true, organismeCategory: true, organismeCategoryDetail: true, plan: true, customBrandingEnabled: true, logoUrl: true },
    })
    if (assoc) {
      // Null receiptMode (no tier, same as a standalone donation) means "always receipt
      // when the association can issue them" — see the field's comment in schema.prisma.
      const issueReceipt = don.receiptMode !== "NONE"
      let pdfAttachment: { filename: string; content: Buffer } | undefined

      if (assoc.canIssueTaxReceipts && issueReceipt) {
        try {
          const pdf = await generateRecuFiscalForDon(don, assoc)
          pdfAttachment = { filename: `recu-fiscal-${don.receiptNumber ?? don.id}.pdf`, content: pdf }
        } catch (err) {
          reportError(err, { area: "payments", action: "dons.manual.generate-recu-fiscal", extra: { associationId: ctx.associationId, donId: don.id } })
        }
      }

      sendEmail({
        ...donConfirmationEmail({
          firstName,
          email,
          associationName:     assoc.name,
          amount:              data.amount,
          paidAt,
          canIssueTaxReceipts: assoc.canIssueTaxReceipts && issueReceipt,
          receiptNumber:       don.receiptNumber ?? undefined,
          donorType:           "INDIVIDUAL",
          branding:            await resolveEmailBranding(ctx.associationId),
        }),
        attachments: pdfAttachment ? [pdfAttachment] : undefined,
      }, { associationId: ctx.associationId, membreId: membreId ?? undefined, source: "TRANSACTION", sourceId: don.id })
        .catch(error => reportError(error, { area: "email", action: "dons.manual-confirmation-email", extra: { associationId: ctx.associationId, donId: don.id } }))
    }
  }

  if (data.notifyResponsible) {
    notifyDonResponsable({
      associationId: ctx.associationId, donId: don.id,
      donorLabel: `${firstName} ${lastName}`,
      amount: data.amount, paymentMethod: data.paymentMethod, paidAt: true,
    }).catch(error => reportError(error, { area: "api", action: "dons.manual.notify-responsable", extra: { associationId: ctx.associationId, donId: don.id } }))
  }

  return NextResponse.json(don, { status: 201 })
}, { area: "dons", module: "dons" })
