// Every tool returns a JSON string to the model. A thrown error (Prisma, Sanity, a bad id)
// becomes `{ error }` text rather than an exception, so the model can tell the user what
// failed and carry on instead of the whole run aborting.
export async function runToolSafely(toolName: string, produce: () => Promise<unknown>): Promise<string> {
  try {
    return JSON.stringify(await produce())
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erreur inattendue"
    console.error(`[assistant] tool ${toolName} failed:`, error)
    return JSON.stringify({ error: message })
  }
}

// Prisma Decimal columns come back as Decimal objects — the model gets plain euros.
export function toEuros(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value)
}

export function toIsoDate(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null
}
