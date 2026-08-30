import { auth } from "@/lib/auth/config"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

// `?preview=1` on a public form URL lets a logged-in manager of the association open a
// DRAFT / PRIVATE form exactly as a visitor would see it (the "Aperçu" button in the form
// builders). Anyone else — or any request without the flag — keeps the normal
// PUBLISHED-only gate; the public form itself disables submission in this mode.
export async function canPreviewForm(req: Request, associationId: string): Promise<boolean> {
  if (new URL(req.url).searchParams.get("preview") !== "1") return false
  const session = await auth()
  const u = session?.user as { associationId?: string | null; role?: string } | undefined
  return !!u && u.associationId === associationId && MANAGERS.includes(u.role ?? "")
}
