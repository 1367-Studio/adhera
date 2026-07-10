/**
 * Extracts a readable message from a failed API response.
 * Handles both { error: string } and { error: ZodIssue[] } shapes.
 */
export async function apiErrorMessage(res: Response, fallback = "Erreur"): Promise<string> {
  try {
    const data = await res.json()
    if (typeof data.error === "string") return data.error
    if (Array.isArray(data.error) && data.error.length > 0) {
      return data.error[0]?.message ?? fallback
    }
    return fallback
  } catch {
    return fallback
  }
}

// Same message extraction as apiErrorMessage, but also carries the optional { code } some
// routes return (see src/lib/api-error-codes.ts) — for callers whose UI needs to react
// specifically to one error (e.g. an "upgrade" action button) rather than just display it.
// A separate export rather than changing apiErrorMessage's return type, since that's
// already relied on as a plain string by every other call site.
export class ApiError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message)
    this.name = "ApiError"
  }
}

export async function apiError(res: Response, fallback = "Erreur"): Promise<ApiError> {
  try {
    const data = await res.json()
    const message =
      typeof data.error === "string" ? data.error :
      Array.isArray(data.error) && data.error.length > 0 ? (data.error[0]?.message ?? fallback) :
      fallback
    return new ApiError(message, typeof data.code === "string" ? data.code : undefined)
  } catch {
    return new ApiError(fallback)
  }
}
