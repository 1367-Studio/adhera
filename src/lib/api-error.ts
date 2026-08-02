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

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    // Any extra structured fields the response carried alongside error/code (e.g.
    // gapDays, expectedStartDate) — callers that need to react to more than just the
    // code (like a confirmation dialog showing the exact gap or expected dates) read
    // them from here instead of re-fetching or re-parsing the response themselves.
    public readonly details?: Record<string, unknown>,
  ) {
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
    const { error: _error, code, ...details } = data
    return new ApiError(
      message,
      typeof code === "string" ? code : undefined,
      Object.keys(details).length > 0 ? details : undefined,
    )
  } catch {
    return new ApiError(fallback)
  }
}
