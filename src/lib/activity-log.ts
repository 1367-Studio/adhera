import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma/client"

interface WriteActivityLogOptions {
  associationId: string
  actorId?:      string | null
  action:        string
  entity:        string
  entityId?:     string | null
  label?:        string | null
  metadata?:     Prisma.InputJsonValue
}

export async function writeActivityLog(opts: WriteActivityLogOptions): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        associationId: opts.associationId,
        actorId:       opts.actorId  ?? null,
        action:        opts.action,
        entity:        opts.entity,
        entityId:      opts.entityId ?? null,
        label:         opts.label    ?? null,
        metadata:      opts.metadata ?? Prisma.DbNull,
      },
    })
  } catch {
    // Never throws — logging failure must not break main flow
  }
}

type FieldDiff = { old: string | null; new: string | null }

function normalizeForDiff(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null
  if (v instanceof Date) return v.toISOString().split("T")[0]
  if (typeof v === "object" && typeof (v as { toNumber?: unknown }).toNumber === "function") {
    return String((v as { toNumber(): number }).toNumber())
  }
  // Plain objects (e.g. the `modules` JSON blob) — stringify so the diff shows the actual
  // shape instead of the useless "[object Object]" String(v) would otherwise produce.
  if (typeof v === "object") return JSON.stringify(v)
  return String(v)
}

export function computeDiff(
  before: Record<string, unknown>,
  after:  Record<string, unknown>,
  fields: readonly string[],
): Record<string, FieldDiff> {
  const changes: Record<string, FieldDiff> = {}
  for (const field of fields) {
    const oldStr = normalizeForDiff(before[field])
    const newStr = normalizeForDiff(after[field])
    if (oldStr !== newStr) changes[field] = { old: oldStr, new: newStr }
  }
  return changes
}

const MEMBRE_FIELDS = ["firstName", "lastName", "email", "phone", "address", "birthDate", "status", "typeId"] as const

export function computeMemberDiff(
  before: Record<string, unknown>,
  after:  Record<string, unknown>,
): Record<string, FieldDiff> {
  return computeDiff(before, after, MEMBRE_FIELDS)
}

const FOURNISSEUR_FIELDS = [
  "companyName", "tradeName", "contactName", "contactRole", "siret", "siren",
  "vatNumber", "address", "city", "postalCode", "country", "email",
  "billingEmail", "phone", "website", "category", "status", "notes",
] as const

export function computeFournisseurDiff(
  before: Record<string, unknown>,
  after:  Record<string, unknown>,
): Record<string, FieldDiff> {
  return computeDiff(before, after, FOURNISSEUR_FIELDS)
}

const ASSOCIATION_FIELDS = ["internalNotes", "customMemberLimit", "customBrandingEnabled", "modules"] as const

export function computeAssociationDiff(
  before: Record<string, unknown>,
  after:  Record<string, unknown>,
): Record<string, FieldDiff> {
  return computeDiff(before, after, ASSOCIATION_FIELDS)
}
