import { z } from "zod"
import { MERGEABLE_MEMBRE_FIELDS } from "@/lib/membre-merge-fields"

// ─── List (GET /api/membres/duplicates, GET /api/backoffice/membre-duplicates) ───────────

export const membreDuplicateMatchStatusSchema = z.enum(["PENDING", "DISMISSED", "MERGED"])

export type MembreDuplicateSummary = {
  id:        string
  firstName: string
  lastName:  string
  email:     string | null
  phone:     string | null
  status:    string
}

export type MembreDuplicateMatchListItem = {
  id:              string
  associationId:   string
  membreA:         MembreDuplicateSummary
  membreB:         MembreDuplicateSummary
  matchedFields:   string[]
  status:          z.infer<typeof membreDuplicateMatchStatusSchema>
  firstDetectedAt: string
  lastSeenAt:      string
  autoDismissed:   boolean
}

// ─── Dismiss / restore (PATCH /api/membres/duplicates/[id]) ──────────────────────────────

export const membreDuplicateMatchPatchSchema = z.object({
  status: z.enum(["PENDING", "DISMISSED"], { message: "Statut invalide" }),
})

export type MembreDuplicateMatchPatchInput = z.input<typeof membreDuplicateMatchPatchSchema>

// ─── Detail (GET /api/membres/duplicates/[id]) ───────────────────────────────────────────

export type MembreDuplicateRelationCounts = Record<string, number>

// The full Membre row, loosely typed — the compare screen reads a fixed set of known scalar
// fields (via MERGEABLE_MEMBRE_FIELDS) plus id/userId, and tolerates any other column coming
// along for the ride without needing every one of ~40 columns declared here.
export type MembreDuplicateFullMembre = Record<string, unknown> & {
  id: string
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  // Resolved alongside typeId so the compare screen can show a name instead of a raw id.
  type: { name: string } | null
  userId: string | null
}

export type MembreDuplicateDetail = {
  id:            string
  status:        z.infer<typeof membreDuplicateMatchStatusSchema>
  matchedFields: string[]
  membreA:       MembreDuplicateFullMembre
  membreB:       MembreDuplicateFullMembre
  relationCounts: {
    membreA: MembreDuplicateRelationCounts
    membreB: MembreDuplicateRelationCounts
  }
  // Natural-key collisions detectable ahead of merging (e.g. both sides have a Cotisation for
  // the same year) — same shape as the real conflicts a merge attempt would report, computed
  // read-only so the compare screen can warn before the admin commits to anything.
  potentialConflicts: { table: string; reason: string }[]
}

// ─── Merge (POST /api/membres/duplicates/[id]/merge) ─────────────────────────────────────

export const fieldResolutionSchema = z.enum(["PRIMARY", "SECONDARY"])

export const membreDuplicateMergeRequestSchema = z.object({
  primaryMembreId:  z.string().min(1, "Membre principal requis"),
  fieldResolutions: z.partialRecord(z.enum(MERGEABLE_MEMBRE_FIELDS), fieldResolutionSchema).optional().default({}),
})

export type MembreDuplicateMergeRequest = z.input<typeof membreDuplicateMergeRequestSchema>

export type MembreDuplicateMergeResponse = {
  relationCounts:            Record<string, number>
  conflicts:                 { table: string; id: string; reason: string }[]
  portalAccountDeactivated:  boolean
}

// ─── Backoffice scan (POST /api/backoffice/membre-duplicates/scan) ───────────────────────

export const backofficeMembreDuplicatesScanRequestSchema = z.object({
  associationId: z.string().min(1, "Association requise"),
})

export type BackofficeMembreDuplicatesScanRequest = z.input<typeof backofficeMembreDuplicatesScanRequestSchema>
