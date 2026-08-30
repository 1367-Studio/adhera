import { NextResponse } from "next/server"
import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma/client"
import { portalRegisterSchema } from "@/lib/schemas"
import { sendEmail } from "@/lib/mail"
import { portalWelcomeEmail } from "@/lib/email"
import { APP_URL } from "@/lib/env"
import { writeActivityLog } from "@/lib/activity-log"
import { assertMemberLimit, MemberLimitReachedError, MEMBER_LIMIT_VISITOR_MESSAGE, resolveDocumentBranding } from "@/lib/plan-limits"
import { CURRENT_TERMS_VERSION, consentIp } from "@/lib/consent"
import { maybeCreateDefaultCotisation, findPendingCotisation } from "@/lib/cotisation-defaults"
import { pusherServer } from "@/lib/pusher-server"

function generatePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789"
  return Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join("")
}

export async function POST(req: Request) {
  const body   = await req.json().catch(() => null)
  const { slug, ...rest } = body ?? {}

  if (!slug) return NextResponse.json({ error: "Slug manquant" }, { status: 400 })

  const parsed = portalRegisterSchema.safeParse(rest)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Données invalides" }, { status: 422 })
  }

  const { firstName, lastName, email, typeId, locale } = parsed.data
  const acceptedIp = consentIp(req)

  const association = await prisma.association.findUnique({
    where:  { slug },
    select: { id: true, name: true, plan: true, customBrandingEnabled: true, logoUrl: true, modules: true, cotisationDefaultAmount: true },
  })
  if (!association) return NextResponse.json({ error: "Association introuvable" }, { status: 404 })

  const existing = await prisma.user.findFirst({
    where: { email: email.toLowerCase(), associationId: association.id, deletedAt: null },
  })
  if (existing) return NextResponse.json({ error: "Un compte existe déjà avec cet email" }, { status: 409 })

  if (typeId) {
    const validType = await prisma.membreType.findFirst({
      where: { id: typeId, associationId: association.id },
    })
    if (!validType) return NextResponse.json({ error: "Type de membre invalide." }, { status: 422 })
  }

  try {
    await assertMemberLimit(association.id)
  } catch (err) {
    if (err instanceof MemberLimitReachedError) return NextResponse.json({ error: MEMBER_LIMIT_VISITOR_MESSAGE }, { status: 422 })
    throw err
  }

  const password     = generatePassword()
  const passwordHash = await bcrypt.hash(password, 12)

  const { membreId, userId, cotisation } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email:           email.toLowerCase(),
        name:            `${firstName} ${lastName}`,
        passwordHash,
        role:            "MEMBRE",
        associationId:   association.id,
        termsAcceptedAt: new Date(),
        termsVersion:    CURRENT_TERMS_VERSION,
        termsAcceptedIp: acceptedIp,
      },
    })

    // Link to existing unlinked Membre by email if available, to avoid duplicates
    const existingMembre = await tx.membre.findFirst({
      where: {
        email:         email.toLowerCase(),
        associationId: association.id,
        userId:        null,
        deletedAt:     null,
      },
      select: { id: true },
    })

    let membreId: string
    if (existingMembre) {
      await tx.membre.update({
        where: { id: existingMembre.id },
        data:  { userId: user.id, firstName, lastName, status: "ACTIF", preferredLocale: locale || undefined },
      })
      membreId = existingMembre.id
    } else {
      const membre = await tx.membre.create({
        data: {
          firstName,
          lastName,
          email:         email.toLowerCase(),
          associationId: association.id,
          userId:        user.id,
          status:        "ACTIF",
          typeId:        typeId || null,
          preferredLocale: locale || null,
        },
      })
      membreId = membre.id
    }

    await maybeCreateDefaultCotisation(tx, membreId, association.id, association)
    // Whatever's pending now — just auto-created above, or already sitting there from an
    // admin manually creating one before this person ever registered (e.g. a pre-existing
    // Membre placeholder being linked to their new account here).
    const cotisation = await findPendingCotisation(tx, membreId)
    return { membreId, userId: user.id, cotisation }
  })

  if (membreId) {
    await writeActivityLog({ associationId: association.id, action: "MEMBRE_PORTAL_REGISTERED", entity: "Membre", entityId: membreId, label: `${firstName} ${lastName}` })
  }

  // Surface the auto-created cotisation beyond the silent DB row — same in-app notification
  // pattern as new events/actualités/sondages (src/app/api/evenements/route.ts etc.), plus a
  // mention in the welcome email below, since the member otherwise only finds out by
  // stumbling onto the Cotisation tab themselves.
  if (cotisation && userId) {
    prisma.notification.create({
      data: {
        userId,
        title: "Cotisation à régler",
        body:  `Votre cotisation ${cotisation.year} de ${Number(cotisation.amount).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })} est en attente de paiement.`,
        link:  `/portal/${slug}/cotisation`,
      },
    })
      .then(() => pusherServer.trigger(`private-association-${association.id}`, "new-notification", {}))
      .catch(() => {})
  }

  const loginUrl = `${APP_URL}/portal/${slug}/login`
  sendEmail(portalWelcomeEmail({
    firstName,
    email: email.toLowerCase(),
    password,
    associationName: association.name,
    loginUrl,
    branding: resolveDocumentBranding(association),
    cotisation: cotisation ? { amount: Number(cotisation.amount), year: cotisation.year } : undefined,
  })).catch(() => {})

  return NextResponse.json({ ok: true }, { status: 201 })
}
