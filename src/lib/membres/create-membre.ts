import type { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"
import { recordAcceptances } from "@/lib/legal/acceptance"
import { fireEventRule } from "@/lib/fire-event-rule"
import { addressColumns } from "@/lib/address"
import { answersWithMobile } from "@/lib/membre-answers"
import { writeActivityLog } from "@/lib/activity-log"
import type { MembreCreateInput } from "@/lib/schemas"

// What a manager-side creation of a Membre shares, whatever the entry point: the manual add
// (POST /api/membres) and the paper form import (POST /api/membres/scan/commit). Only the
// parts that must not drift between the two live here — the account/invitation side of the
// manual add stays in its route, a scanned sheet never creates a login.

// Everything the creation flow reads from the association: default cotisation, invitation
// email branding, MEMBER_CREATED automation.
export const MEMBRE_CREATION_ASSOCIATION_SELECT = {
  name: true, slug: true, modules: true, plan: true, customBrandingEnabled: true, logoUrl: true, cotisationDefaultAmount: true,
} as const

export function findMembreCreationAssociation(associationId: string) {
  return prisma.association.findUnique({
    where:  { id: associationId },
    select: MEMBRE_CREATION_ASSOCIATION_SELECT,
  })
}

export type MembreCreationAssociation = NonNullable<Awaited<ReturnType<typeof findMembreCreationAssociation>>>

type NullableOptional<Fields> = { [Key in keyof Fields]?: Fields[Key] | null }

export type MembreColumnsInput = NullableOptional<Pick<MembreCreateInput,
  | "email" | "phone" | "birthDate"
  | "address" | "addressStreet" | "addressComplement" | "postalCode" | "city" | "country"
  | "typeId" | "civilite" | "sexe" | "groupeSanguin" | "allergies" | "spokenLanguage"
  | "possedeTshirt" | "tailleTshirt" | "responsableId" | "notes" | "imageRightsConsent"
  | "guardianName" | "guardianPhone" | "secondGuardianName" | "secondGuardianPhone"
>> & { mobile?: string }

// The Membre columns derived from what the manager typed (or confirmed from a scan). Empty
// values ("" from a form, null from the import) are all stored as null.
export function membreColumns(associationId: string, fields: MembreColumnsInput) {
  const {
    email, phone, mobile, birthDate, address, addressStreet, addressComplement, postalCode, city, country,
    typeId, civilite, sexe, groupeSanguin, allergies, spokenLanguage, possedeTshirt, tailleTshirt, responsableId,
    notes, imageRightsConsent, guardianName, guardianPhone, secondGuardianName, secondGuardianPhone,
  } = fields

  return {
    associationId,
    email:         email         || null,
    phone:         phone         || null,
    // Le mobile n'a pas de colonne : il part dans answers (voir src/lib/membre-answers.ts).
    ...(mobile !== undefined ? { answers: answersWithMobile(null, mobile) } : {}),
    // Les six colonnes d'adresse sont écrites ensemble, colonne héritée comprise — voir
    // addressColumns dans src/lib/address.ts.
    ...addressColumns({ street: addressStreet, complement: addressComplement, postalCode, city, country, legacy: address }),
    typeId:        typeId        || null,
    civilite:      civilite      || null,
    sexe:          sexe          || null,
    groupeSanguin: groupeSanguin || null,
    allergies:     allergies     || null,
    spokenLanguage: spokenLanguage || null,
    // Never persist "does not have a t-shirt" alongside a size (see membre-form.tsx's
    // matching reactive clear on the client — this is the server-side backstop).
    possedeTshirt: possedeTshirt === undefined || possedeTshirt === null || possedeTshirt === "" ? null : possedeTshirt === "true",
    tailleTshirt:  possedeTshirt === "false" ? null : (tailleTshirt || null),
    responsableId: responsableId || null,
    birthDate: birthDate ? new Date(birthDate + "T12:00:00") : null,
    notes:         notes         || null,
    guardianName:        guardianName        || null,
    guardianPhone:       guardianPhone       || null,
    secondGuardianName:  secondGuardianName  || null,
    secondGuardianPhone: secondGuardianPhone || null,
    // Tri-state (voir Membre.imageRightsConsent) : une réponse explicite est datée, l'absence
    // de réponse reste null — jamais "refusé" par défaut.
    ...(imageRightsConsent === "true" || imageRightsConsent === "false"
      ? { imageRightsConsent: imageRightsConsent === "true", imageRightsConsentAt: new Date() }
      : {}),
  }
}

// Acceptation recueillie hors ligne : enregistrée uniquement parce que le gestionnaire l'a
// explicitement attestée (case de la saisie manuelle, case cochée sur la fiche papier), jamais
// déduite de la création du membre — sinon on fabriquerait une preuve que personne n'a donnée.
// collectedById garde la trace de qui s'est engagé.
export async function recordOfflineAcceptances(
  input: {
    associationId: string
    revisionIds:   string[]
    membre:        { id: string; userId: string | null }
    collectedById: string
  },
  client: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<void> {
  await recordAcceptances({
    associationId: input.associationId,
    revisionIds:   input.revisionIds,
    identity:      { membreId: input.membre.id, userId: input.membre.userId },
    context:       "DASHBOARD_OFFLINE",
    contextId:     input.membre.id,
    collectedById: input.collectedById,
  }, client)
}

// Once the Membre row is committed: the MEMBER_CREATED automation (fire-and-forget, like
// every automation trigger) and the MEMBRE_CREATED activity log entry.
export async function announceMembreCreated(input: {
  associationId:         string
  actorId:               string
  association:           MembreCreationAssociation | null
  membre:                { id: string; firstName: string; lastName: string; email: string | null; phone: string | null }
  fireMemberCreatedRule: boolean
  metadata?:             Prisma.InputJsonValue
}): Promise<void> {
  const { associationId, actorId, association, membre, fireMemberCreatedRule, metadata } = input

  if (association && fireMemberCreatedRule) {
    fireEventRule({
      triggerType:   "MEMBER_CREATED",
      associationId,
      association:   { name: association.name, slug: association.slug, modules: association.modules, plan: association.plan, customBrandingEnabled: association.customBrandingEnabled, logoUrl: association.logoUrl },
      membre:        { id: membre.id, firstName: membre.firstName, lastName: membre.lastName, email: membre.email, phone: membre.phone },
    }).catch(() => {})
  }

  await writeActivityLog({ associationId, actorId, action: "MEMBRE_CREATED", entity: "Membre", entityId: membre.id, label: `${membre.firstName} ${membre.lastName}`, metadata })
}
