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
