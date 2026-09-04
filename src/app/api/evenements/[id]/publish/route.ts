import { NextResponse } from "next/server"
import { z } from "zod"
import { getTranslations } from "next-intl/server"
import { prisma } from "@/lib/prisma/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { pusherServer } from "@/lib/pusher-server"
import { revalidatePublicSite } from "@/lib/association/revalidate-site"
import { APP_TIME_ZONE } from "@/lib/date-format"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

const actionSchema = z.object({
  action: z.enum(["publish", "unpublish", "archive", "duplicate"]),
})

export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId, userId } = ctx

  const evenement = await prisma.evenement.findFirst({
    where:   { id, associationId },
    include: { ticketTypes: true, customFields: true },
  })
  if (!evenement) return NextResponse.json({ error: "Événement introuvable" }, { status: 404 })

  const body   = await req.json().catch(() => null)
  const parsed = actionSchema.safeParse(body)
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues }, { status: 422 })

  const { action } = parsed.data

  if (action === "duplicate") {
    const t     = await getTranslations("evenements")
    const title = `${evenement.title} ${t("duplicateSuffix")}`

    const copy = await prisma.evenement.create({
      data: {
        associationId, title,
        description: evenement.description,
        imageUrl:    evenement.imageUrl,
        date:        evenement.date,
        endDate:     evenement.endDate,
        location:    evenement.location,
        lat:         evenement.lat,
        lng:         evenement.lng,
        price:       evenement.price,
        capacity:    evenement.capacity,
        adminNotificationEmail: evenement.adminNotificationEmail,
        contactEmail:           evenement.contactEmail,
        contactPhone:           evenement.contactPhone,
        waitlistEnabled:        evenement.waitlistEnabled,
        allowCash:              evenement.allowCash,
        allowCheque:            evenement.allowCheque,
        allowTransfer:          evenement.allowTransfer,
        offlineInstructions:    evenement.offlineInstructions,
        confirmationMessage:    evenement.confirmationMessage,
        conditions:             evenement.conditions,
        attachments:            evenement.attachments ?? undefined,
        requireCguvSignature:   evenement.requireCguvSignature,
        fieldPhone:             evenement.fieldPhone,
        fieldAddress:           evenement.fieldAddress,
        fieldBirthDate:         evenement.fieldBirthDate,
        fieldGender:            evenement.fieldGender,
        fieldMobile:            evenement.fieldMobile,
        status:     "DRAFT",
        visibility: "LINK",
        // Pas de QR ni de fenêtre de dates hérités — un événement dupliqué est une nouvelle
        // occurrence, pas une réouverture de l'ancienne (même raisonnement que
        // MembershipTier.fixedPeriodEnd lors d'une duplication de formulaire d'adhésion).
        // Même chose pour la fenêtre de vente propre à chaque tarif ci-dessous.
        qrToken:     null,
        qrExpiresAt: null,
        opensAt:     null,
        closesAt:    null,
        ticketTypes: {
          create: evenement.ticketTypes.map(tt => ({
            itemType: tt.itemType, label: tt.label, price: tt.price, priceBeforeDiscount: tt.priceBeforeDiscount,
            capacity: tt.capacity, order: tt.order, active: tt.active,
            receiptMode: tt.receiptMode, ineligibleAmount: tt.ineligibleAmount,
          })),
        },
        // Les codes promotionnels ne sont pas dupliqués — un usesCount/maxUses hérité tel
        // quel donnerait l'impression qu'un code neuf a déjà été partiellement consommé (ou
        // doublerait silencieusement le quota promotionnel prévu), et ticketTypeIds pointerait
        // de toute façon vers les tarifs de l'ancien événement, pas les nouvelles copies
        // créées ci-dessus. Laissé à l'admin de recréer volontairement si besoin.
        customFields: {
          create: evenement.customFields.map(f => ({
            type: f.type, label: f.label, required: f.required, order: f.order, options: f.options ?? undefined,
          })),
        },
      },
    })

    await writeActivityLog({
      associationId, actorId: userId,
      action:   "EVENEMENT_DUPLICATED",
      entity:   "Evenement",
      entityId: copy.id,
      label:    copy.title,
      metadata: { sourceEvenementId: id, sourceTitle: evenement.title },
    })

    return NextResponse.json(copy, { status: 201 })
  }

  const status = action === "publish" ? "PUBLISHED" : action === "unpublish" ? "DRAFT" : "ARCHIVED"
  const wasPublished = evenement.status === "PUBLISHED"

  const updated = await prisma.evenement.update({ where: { id }, data: { status } })
  await revalidatePublicSite((await prisma.association.findUnique({ where: { id: associationId }, select: { slug: true } }))?.slug ?? "")

  await writeActivityLog({
    associationId, actorId: userId,
    action:   `EVENEMENT_${status}`,
    entity:   "Evenement",
    entityId: id,
    label:    evenement.title,
  })

  // Ne notifie les membres qu'au moment où l'événement devient réellement visible pour la
  // première fois (ou de nouveau, après un archivage) — pas à la création (voir POST
  // /api/evenements) ni sur une republication qui ne change rien pour eux.
  if (action === "publish" && !wasPublished) {
    const pusherReady = !!(process.env.PUSHER_APP_ID && process.env.PUSHER_KEY && process.env.PUSHER_SECRET)
    const [members, association] = await Promise.all([
      prisma.membre.findMany({
        where:  { associationId, deletedAt: null, status: "ACTIF", userId: { not: null } },
        select: { userId: true },
      }),
      prisma.association.findUnique({ where: { id: associationId }, select: { slug: true } }),
    ])
    const notifDateStr = updated.date.toLocaleDateString("fr-FR", { timeZone: APP_TIME_ZONE, weekday: "long", day: "numeric", month: "long" })
    const notifBody    = [notifDateStr, updated.location].filter(Boolean).join(" · ")
    void (async () => {
      await prisma.notification.createMany({
        data: members.map(m => ({ userId: m.userId!, title: updated.title, body: notifBody || null, link: `/portal/${association?.slug}/evenements` })),
        skipDuplicates: true,
      })
      if (pusherReady) {
        await pusherServer.trigger(`private-association-${associationId}`, "new-notification", {})
      }
    })()
  }

  return NextResponse.json(updated)
}, { roles: MANAGERS, module: "evenements" })
