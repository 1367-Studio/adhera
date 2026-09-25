import { useQueryClient } from "@tanstack/react-query"
import { apiError } from "@/lib/api-error"
import type {
  PaperFormCommitForm,
  PaperFormCommitResponse,
  PaperFormCommitResult,
  PaperFormDuplicatePerson,
  PaperFormDuplicatesResponse,
  PaperFormExtractResponse,
} from "@/lib/schemas/paper-form"

// ─── Extract ─────────────────────────────────────────────────────────────────────────────

// `code` of the 422 the vision routes answer when the association has no vision-capable key.
const VISION_NOT_SUPPORTED_CODE = "VISION_NOT_SUPPORTED"
// `code` of the 422 a strict template answers when the page is not its paper form.
const FORM_MISMATCH_CODE = "FORM_MISMATCH"

export type ExtractOutcome =
  | { kind: "success"; data: PaperFormExtractResponse }
  // Errors that concern the whole batch (no vision key, module off, template gone): reading
  // any other page would fail the same way, so the runner stops.
  | { kind: "fatal"; message: string; visionNotSupported: boolean }
  // Too many calls this hour — nothing is wrong with the page, the batch pauses.
  | { kind: "rateLimited"; message: string }
  | { kind: "pageError"; message: string }
  // Strict template: this page is not the expected paper form. Final for that page — reading
  // it again would be refused the same way — but the other pages go on.
  | { kind: "formMismatch"; message: string; detectedTitle: string | null }

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const error = await apiError(response, fallback)
  return error.message
}

export async function extractPage(
  templateId: string,
  page: { base64: string; mediaType: "image/jpeg" | "image/png" },
  signal: AbortSignal,
  fallbackMessage: string,
): Promise<ExtractOutcome> {
  let response: Response
  try {
    response = await fetch("/api/membres/scan/extract", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ templateId, page }),
      signal,
    })
  } catch (error) {
    if (signal.aborted) throw error
    return { kind: "pageError", message: fallbackMessage }
  }

  if (response.ok) return { kind: "success", data: await response.json() as PaperFormExtractResponse }

  // 422 FORM_MISMATCH = this page is not the strict template's form; 422 with another plain
  // message = batch-wide refusal (no vision-capable key, template with no readable field);
  // 422 with zod issues = this page's payload, handled as a page error.
  if (response.status === 422) {
    const body = await response.json().catch(() => null) as { error?: unknown; code?: unknown; detectedTitle?: unknown } | null
    if (body?.code === FORM_MISMATCH_CODE) {
      const detectedTitle = typeof body.detectedTitle === "string" && body.detectedTitle.trim() ? body.detectedTitle.trim() : null
      return { kind: "formMismatch", message: typeof body.error === "string" ? body.error : fallbackMessage, detectedTitle }
    }
    if (typeof body?.error === "string") {
      return { kind: "fatal", message: body.error, visionNotSupported: body.code === VISION_NOT_SUPPORTED_CODE }
    }
    return { kind: "pageError", message: fallbackMessage }
  }
  if (response.status === 403 || response.status === 404) {
    return { kind: "fatal", message: await readErrorMessage(response, fallbackMessage), visionNotSupported: false }
  }
  if (response.status === 429) {
    return { kind: "rateLimited", message: await readErrorMessage(response, fallbackMessage) }
  }
  return { kind: "pageError", message: await readErrorMessage(response, fallbackMessage) }
}

// ─── Duplicates ──────────────────────────────────────────────────────────────────────────

export async function checkDuplicates(people: PaperFormDuplicatePerson[]): Promise<PaperFormDuplicatesResponse["matches"]> {
  if (people.length === 0) return {}
  const response = await fetch("/api/membres/scan/duplicates", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ people }),
  })
  if (!response.ok) throw await apiError(response, "Erreur lors de la recherche de doublons")
  const body = await response.json() as PaperFormDuplicatesResponse
  return body.matches ?? {}
}

// ─── Commit ──────────────────────────────────────────────────────────────────────────────

// A refusal of the whole request (plan limit, 422 with `code`) throws an ApiError; failures of
// single forms come back in the results.
export async function commitForms(templateId: string, forms: PaperFormCommitForm[]): Promise<PaperFormCommitResult[]> {
  const response = await fetch("/api/membres/scan/commit", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ templateId, forms }),
  })
  if (!response.ok) throw await apiError(response, "Erreur lors de la création des membres")
  const body = await response.json() as PaperFormCommitResponse
  return body.results
}

// Same set useCreateMembre refreshes (src/hooks/use-membres.ts), since new members change
// the list, the counters, the adults picker and the activity feed alike.
export function useInvalidateMembres() {
  const queryClient = useQueryClient()
  return () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["membres"] }),
    queryClient.invalidateQueries({ queryKey: ["membres-active"] }),
    queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    queryClient.invalidateQueries({ queryKey: ["activity-logs"] }),
  ])
}
