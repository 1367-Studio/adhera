import { NextResponse } from "next/server"
import { z } from "zod"
import { resolveAiConfig } from "@/lib/ai/client"
import { completeText } from "@/lib/ai/complete"
import { normalizeAiHtml } from "@/lib/ai/normalize-html"
import { withAdminAuth } from "@/lib/api-wrapper"
import { reportError } from "@/lib/monitoring"
import { rateLimit } from "@/lib/rate-limit"

const schema = z.object({
  action:      z.enum(["generate", "improve", "rephrase", "summarize", "fix", "translate"]),
  instruction: z.string().max(500).optional(),
  currentText: z.string().max(10000).optional(),
})

const SYSTEM_PROMPT =
  "Tu es un assistant d'écriture pour associations françaises loi 1901. " +
  "Rédige des textes formels, clairs et professionnels en français, sauf lorsque la demande est " +
  "explicitement une traduction vers une autre langue : réponds alors uniquement dans cette langue. " +
  "Réponds UNIQUEMENT avec le texte demandé, sans commentaires ni explications. " +
  "Le texte est inséré tel quel dans un éditeur HTML : réponds exclusivement en HTML, " +
  "en utilisant uniquement les balises <p>, <strong>, <em>, <u>, <h2>, <h3>, <ul>, <ol>, <li>, " +
  "<a href=\"...\">, <blockquote> et <hr>. N'utilise jamais de syntaxe markdown (**, #, -, etc.), " +
  "et n'entoure pas la réponse de balises <html>/<body> ni de bloc de code."

function buildUserPrompt(action: string, instruction?: string, currentText?: string): string {
  const text = currentText?.trim()
  switch (action) {
    case "generate":
      return `Rédige un texte professionnel pour : ${instruction ?? "une association française"}`
    case "improve":
      return `Améliore et professionnalise ce texte${instruction ? ` (${instruction})` : ""} :\n\n${text}`
    case "rephrase":
      return `Reformule ce texte en conservant le sens${instruction ? ` (${instruction})` : ""} :\n\n${text}`
    case "summarize":
      return `Résume ce texte en conservant les points essentiels :\n\n${text}`
    case "fix":
      return `Corrige l'orthographe, la grammaire et la ponctuation de ce texte, sans changer son sens, son ton ni sa mise en forme :\n\n${text}`
    case "translate":
      return `Traduis ce texte en ${instruction?.trim() || "anglais"}, en conservant la mise en forme HTML :\n\n${text}`
    default:
      return instruction ?? ""
  }
}

export const POST = withAdminAuth(async (req, ctx) => {
  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 400 })

  const { action, instruction, currentText } = parsed.data

  const aiConfig    = await resolveAiConfig(ctx.associationId)
  const usingOwnKey = !!aiConfig && !aiConfig.usingPlatform

  // Only throttle associations riding on the platform's shared fallback key — one with
  // its own key uses its own quota/cost, not ours.
  if (!usingOwnKey && !(await rateLimit(`ai-write:${ctx.associationId}`, 20, 10 * 60_000))) {
    return NextResponse.json({ error: "Trop de requêtes, réessayez plus tard." }, { status: 429 })
  }

  if (!aiConfig) {
    return NextResponse.json(
      { error: "Aucune clé API configurée. Ajoutez votre clé API dans Paramètres → IA." },
      { status: 503 }
    )
  }

  try {
    // "fix" and "translate" are meant to preserve the original as faithfully as possible —
    // a lower temperature than the creative-writing actions keeps the model from "helpfully"
    // rephrasing or adding content while it corrects or translates.
    const temperature = action === "fix" || action === "translate" ? 0.3 : 0.7

    const raw = await completeText(aiConfig, {
      system: SYSTEM_PROMPT,
      user:   buildUserPrompt(action, instruction, currentText),
      temperature,
      maxTokens: 1500,
    })

    const text = normalizeAiHtml(raw)
    return NextResponse.json({ text })
  } catch (err: unknown) {
    reportError(err, {
      area:   "ai",
      action: `write.${action}`,
      extra:  { associationId: ctx.associationId, provider: aiConfig.provider, model: aiConfig.model },
    })
    const msg = err instanceof Error ? err.message : "Erreur IA"
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}, { module: "ia" })
