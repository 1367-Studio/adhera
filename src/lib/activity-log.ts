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

const MEMBRE_FIELDS = ["firstName", "lastName", "email", "phone", "address", "birthDate", "status", "typeId"] as const

export function computeMemberDiff(
  before: Record<string, unknown>,
  after:  Record<string, unknown>,
): Record<string, FieldDiff> {
  const changes: Record<string, FieldDiff> = {}
  for (const field of MEMBRE_FIELDS) {
    const oldVal = before[field] ?? null
    const newVal = after[field]  ?? null
    const oldStr = oldVal instanceof Date ? oldVal.toISOString().split("T")[0] : String(oldVal ?? "")
    const newStr = newVal instanceof Date ? newVal.toISOString().split("T")[0] : String(newVal ?? "")
    if (oldStr !== newStr) {
      changes[field] = {
        old: oldVal !== null ? oldStr : null,
        new: newVal !== null ? newStr : null,
      }
    }
  }
  return changes
}
