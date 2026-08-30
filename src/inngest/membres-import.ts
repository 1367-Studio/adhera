import { Prisma } from "@prisma/client"
import { inngest } from "@/lib/inngest"
import { prisma } from "@/lib/prisma/client"
import { pusherServer } from "@/lib/pusher-server"
import { writeActivityLog } from "@/lib/activity-log"
import { deriveCotisationStatus } from "@/lib/cotisation-status"
import { recordCotisationPayment } from "@/lib/cotisation-payments"
import { grantMembrePortalAccess } from "@/lib/membre-access"
import { isPlaceholderEmail, normalizeName } from "@/lib/membre-import-matching"
import { notifyBulkSendCompleted } from "@/inngest/bulk-send"
import type { ImportMembreRow } from "@/lib/schemas"

const MATCHED_BY_NAME_SAMPLE_SIZE = 10

// The actual member/cotisation import loop (src/app/api/membres/import/route.ts used to run
// this inline, blocking the request — a 95-row real file took 2-3 minutes against staging
// latency). The route now only validates and enqueues; this function does the real work off
// the request/response cycle, same pattern as bulk email/SMS (see bulk-send.ts).
export const importMembres = inngest.createFunction(
  {
    id: "membres-import",
    triggers: { event: "bulk/membres-import.requested" },
    // Two imports for the same association racing (a double-click, or a re-upload before
    // the first finished) would interleave both loops against the same externalId/email
    // rows — the precheck read a Membre before either write landed, so a genuine duplicate
    // could slip past the P2002 dedup for Cotisation and create two Membre rows for the
    // same person. Serializing per association removes that window entirely.
    concurrency: { limit: 1, key: "event.data.associationId" },
    // If every retry of the function above is exhausted (a bug, a DB outage mid-run, etc.),
    // the admin who triggered the import would otherwise never hear about it — the request
    // that enqueued it already returned 200 with a jobId. This is the only signal they'd get.
    onFailure: async ({ event: failureEvent }) => {
      const { jobId, associationId, actorId, rows } = failureEvent.data.event.data as {
        jobId: string; associationId: string; actorId: string | null; rows: ImportMembreRow[]
      }
      if (actorId) {
        await prisma.notification.create({
          data: {
            userId: actorId,
            title:  "Échec de l'import AssoConnect",
            body:   `L'import de ${rows.length} ligne(s) a échoué après plusieurs tentatives. Aucune donnée n'a pu être importée. Merci de réessayer ou de contacter le support.`,
            link:   "/dashboard/membres",
            scope:  "GESTION",
          },
        })
        await pusherServer.trigger(`private-association-${associationId}`, "new-notification", {}).catch(() => {})
      }
      await notifyBulkSendCompleted(associationId, {
        jobId, kind: "membres-import",
        membersCreated: 0, membersMatched: 0, cotisationsCreated: 0, errors: rows.length, invitesSent: 0,
        importFailed: true,
      })
    },
  },
  async ({ event, step }) => {
    const { jobId, associationId, actorId, rows, inviteToPortal } = event.data as {
      jobId: string; associationId: string; actorId: string | null
      rows: ImportMembreRow[]; inviteToPortal: boolean
    }

    const result = await step.run("import", async () => {
      let membersCreated     = 0
      let membersMatched     = 0
      let cotisationsCreated = 0
      let cotisationsSkipped = 0
      let errors             = 0

      // Surfaced to the admin so they can spot-check the weaker match path — matching by
      // externalId is unambiguous, matching by name+email is a best-effort heuristic that a
      // genuine same-name-same-household coincidence (a father and son sharing both) could fool.
      const matchedByNameOnly: string[] = []
      let matchedByNameOnlyCount = 0

      // Membre ids touched by this import run, eligible for the optional portal invite below
      // (only newly-created/matched rows — never a blanket "invite everyone without an
      // account", which would surprise-email people from unrelated past imports).
      const touchedMembreIds: string[] = []

      for (const row of rows) {
        try {
          // externalId (AssoConnect's own stable contact id) is the most reliable match — it
          // survives a name or email change between two exports of the same client. Falling
          // back to email alone would wrongly merge distinct people who share a household
          // email (e.g. a parent and a minor child) or AssoConnect's own bounce placeholder,
          // shared by several unrelated contacts — see isPlaceholderEmail — so that fallback
          // also requires the name to match (accent-insensitively — see normalizeName).
          let membre = row.externalId
            ? await prisma.membre.findFirst({ where: { associationId, externalId: row.externalId, deletedAt: null } })
            : null
          let matchedVia: "externalId" | "nameEmail" | null = membre ? "externalId" : null

          if (!membre && row.email && !isPlaceholderEmail(row.email)) {
            // Fetch every Membre sharing this email (a household is small, never more than a
            // handful of rows) and compare names in JS with normalizeName — Postgres's own
            // case-insensitive mode doesn't fold accents, so this can't be pushed into the WHERE.
            const candidates = await prisma.membre.findMany({
              where: { associationId, deletedAt: null, email: { equals: row.email, mode: "insensitive" } },
            })
            membre = candidates.find(c =>
              normalizeName(c.firstName) === normalizeName(row.firstName) &&
              normalizeName(c.lastName)  === normalizeName(row.lastName),
            ) ?? null
            if (membre) matchedVia = "nameEmail"
          }

          if (membre) {
            membersMatched++
            if (matchedVia === "nameEmail") {
              matchedByNameOnlyCount++
              if (matchedByNameOnly.length < MATCHED_BY_NAME_SAMPLE_SIZE) matchedByNameOnly.push(`${row.firstName} ${row.lastName}`)
            }

            // Refresh contact info from this row — never destructive (only non-empty values
            // overwrite, and a placeholder email never overwrites a previously-real one) so a
            // re-export with updated details keeps the existing Membre in sync instead of the
            // admin only ever getting the snapshot from whichever import created it.
            const refresh: Prisma.MembreUpdateInput = {}
            if (row.externalId && !membre.externalId) refresh.externalId = row.externalId
            // Only resync the name on an externalId match — that's the one path where a real
            // rename is the point (marriage, spelling correction). On a nameEmail match the
            // two names were already equivalent, so overwriting here would only risk
            // replacing a correctly-accented name with a degraded one from this row.
            if (matchedVia === "externalId") {
              if (row.firstName && row.firstName !== membre.firstName) refresh.firstName = row.firstName
              if (row.lastName  && row.lastName  !== membre.lastName)  refresh.lastName  = row.lastName
            }
            if (row.email && !isPlaceholderEmail(row.email) && row.email !== membre.email) refresh.email = row.email
            if (row.phone)     refresh.phone     = row.phone
            if (row.address)   refresh.address   = row.address
            if (row.sexe)      refresh.sexe      = row.sexe
            if (row.civilite)  refresh.civilite  = row.civilite
            if (row.birthDate) refresh.birthDate = new Date(`${row.birthDate}T12:00:00`)
            if (Object.keys(refresh).length > 0) {
              membre = await prisma.membre.update({ where: { id: membre.id }, data: refresh })
            }
          } else {
            membre = await prisma.membre.create({
              data: {
                associationId,
                externalId: row.externalId || null,
                firstName: row.firstName,
                lastName:  row.lastName,
                email:     row.email || null,
                phone:     row.phone || null,
                address:   row.address || null,
                sexe:      row.sexe || null,
                civilite:  row.civilite || null,
                birthDate: row.birthDate ? new Date(`${row.birthDate}T12:00:00`) : null,
                status:    "ACTIF",
                ...(row.periodStart ? { joinedAt: new Date(row.periodStart) } : {}),
              },
            })
            membersCreated++
          }

          touchedMembreIds.push(membre.id)

          // No amount/year → contact-only row (e.g. AssoConnect export row with a period but
          // no completed transaction) — the Membre above is still created/matched, just no
          // Cotisation.
          if (!row.amount || row.amount <= 0 || !row.year) continue

          let cotisation: { id: string }
          try {
            const status = deriveCotisationStatus({ currentStatus: "EN_ATTENTE", amount: row.amount, amountPaid: 0, dueDate: null })
            cotisation = await prisma.cotisation.create({
              data: {
                membreId:      membre.id,
                associationId,
                amount:        row.amount,
                year:          row.year,
                status,
                note:          row.note || null,
                periodStart:   row.periodStart ? new Date(row.periodStart) : null,
                periodEnd:     row.periodEnd   ? new Date(row.periodEnd)   : null,
              },
              select: { id: true },
            })
            cotisationsCreated++
          } catch (err) {
            // One (membre, year) row already existed — mirrors the dedup approach in the
            // bank-statement import (src/app/api/finances/import/route.ts): try the create,
            // treat a unique-constraint violation as "already imported", not a real failure.
            if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
              cotisationsSkipped++
              continue
            }
            throw err
          }

          if (row.paymentReceived) {
            await prisma.$transaction(tx => recordCotisationPayment(tx, {
              associationId,
              cotisationId: cotisation.id,
              amount:       row.amount!,
              method:       row.method ?? "Autre",
              paidAt:       row.paidAt ? new Date(row.paidAt) : undefined,
              note:         row.note,
              source:       "MANUAL",
            }))
          }
        } catch {
          errors++
        }
      }

      return {
        membersCreated, membersMatched, cotisationsCreated, cotisationsSkipped, errors,
        matchedByNameOnlyCount, matchedByNameOnly, touchedMembreIds,
      }
    })

    let invitesSent = 0
    if (inviteToPortal && result.touchedMembreIds.length > 0) {
      invitesSent = await step.run("invite", async () => {
        const association = await prisma.association.findUnique({
          where:  { id: associationId },
          select: { name: true, slug: true, plan: true, customBrandingEnabled: true, logoUrl: true },
        })
        if (!association) return 0

        const membres = await prisma.membre.findMany({
          where:  { id: { in: result.touchedMembreIds }, userId: null, deletedAt: null },
          select: { id: true, firstName: true, lastName: true, email: true, userId: true },
        })

        // A placeholder email (see isPlaceholderEmail) is a known-dead address — inviting it
        // would silently hand the one available account for that address to whichever one of
        // several unrelated people happened to be processed first (caught live: a real
        // account got created for "inconnue@ros1.org", which can never receive the invite
        // email, permanently occupying that address for the rest).
        const invitable = membres.filter((m): m is typeof m & { email: string } =>
          !!m.email && !isPlaceholderEmail(m.email))

        // grantMembrePortalAccess's email-conflict check is a plain findFirst with no DB-level
        // unique constraint on User.email — two parallel grants for the same email (a shared
        // household address, e.g. two siblings) could both pass the check and create duplicate
        // Users. Batch in parallel for throughput, but never place two rows sharing an email
        // in the same batch — each batch keeps the conflict check meaningfully serialized.
        const INVITE_BATCH_SIZE = 5
        const batches: (typeof invitable)[] = []
        for (const membre of invitable) {
          const batch = batches.find(b => b.length < INVITE_BATCH_SIZE && !b.some(m => m.email === membre.email))
          if (batch) batch.push(membre)
          else batches.push([membre])
        }

        let sent = 0
        for (const batch of batches) {
          const results = await Promise.all(
            batch.map(membre => grantMembrePortalAccess({ membre, associationId, actorId, association })),
          )
          sent += results.filter(r => r.ok).length
        }
        return sent
      })
    }

    await step.run("log-activity", () => writeActivityLog({
      associationId,
      actorId,
      action:   "MEMBRES_IMPORTED",
      entity:   "Membre",
      label:    "Import AssoConnect",
      metadata: {
        membersCreated: result.membersCreated, membersMatched: result.membersMatched,
        cotisationsCreated: result.cotisationsCreated, cotisationsSkipped: result.cotisationsSkipped,
        errors: result.errors, matchedByNameOnlyCount: result.matchedByNameOnlyCount,
        invitesSent, total: rows.length,
      },
    }))

    // A toast alone can't hold the "verify these" name sample, and it's gone the moment the
    // admin navigates away — so the full detail also lands as a persistent in-app
    // notification (same model/pattern as the pending-cotisation nudge in
    // src/app/api/membres/route.ts), while the toast (via useBulkSendListener, mounted in
    // AppSidebar) covers the "it's done" headline regardless of which page they're on by then.
    if (actorId) {
      await step.run("notify-inapp", async () => {
        const bodyParts = [
          `${result.membersCreated} créé(s), ${result.membersMatched} déjà existant(s)`,
          result.cotisationsCreated > 0 ? `${result.cotisationsCreated} cotisation(s) créée(s)` : null,
          invitesSent > 0 ? `${invitesSent} invitation(s) de portail envoyée(s)` : null,
          result.matchedByNameOnlyCount > 0
            ? `${result.matchedByNameOnlyCount} identifié(s) par nom+email (à vérifier) : ${result.matchedByNameOnly.join(", ")}`
            : null,
        ].filter(Boolean)

        await prisma.notification.create({
          data: {
            userId: actorId,
            title:  "Import AssoConnect terminé",
            body:   bodyParts.join(" — "),
            link:   "/dashboard/membres",
            scope:  "GESTION",
          },
        })
        await pusherServer.trigger(`private-association-${associationId}`, "new-notification", {}).catch(() => {})
      })
    }

    await step.run("notify-toast", () => notifyBulkSendCompleted(associationId, {
      jobId, kind: "membres-import",
      membersCreated: result.membersCreated, membersMatched: result.membersMatched,
      cotisationsCreated: result.cotisationsCreated, errors: result.errors, invitesSent,
    }))

    return result
  },
)
