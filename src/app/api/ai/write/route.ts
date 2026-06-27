import { NextResponse } from "next/server"
import { z } from "zod"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { makeGroqClient, platformClient, GROQ_MODEL } from "@/lib/ai/client"
import { guardModule } from "@/lib/auth/require-module"

const schema = z.object({
  action:      z.enum(["generate", "improve", "rephrase", "summarize"]),
  instruction: z.string().max(500).optional(),
  currentText: z.string().max(10000).optional(),
})

const SYSTEM_PROMPT =
  "Tu es un assistant d'écriture pour associations françaises loi 1901. " +
  "Rédige des textes formels, clairs et professionnels en français. " +
  "Réponds UNIQUEMENT avec le texte demandé, sans commentaires ni explications."

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
    default:
      return instruction ?? ""
  }
}

export async function POST(req: Request) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx

  const guard = await guardModule(ctx.associationId, "ia")
  if (guard) return guard

  const body   = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: "Données invalides" }, { status: 400 })

  const { action, instruction, currentText } = parsed.data

  const assoc = await prisma.association.findUnique({
    where:  { id: ctx.associationId },
    select: { aiApiKey: true, aiModel: true },
  })

  const client = assoc?.aiApiKey
    ? makeGroqClient(assoc.aiApiKey)
    : platformClient

  if (!client) {
    return NextResponse.json(
      { error: "Aucune clé API configurée. Ajoutez votre clé Groq dans Paramètres → IA." },
      { status: 503 }
    )
  }

  const model = assoc?.aiModel || GROQ_MODEL

  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: "system",  content: SYSTEM_PROMPT },
        { role: "user",    content: buildUserPrompt(action, instruction, currentText) },
      ],
      temperature: 0.7,
      max_tokens:  1500,
    })

    const text = completion.choices[0]?.message?.content?.trim() ?? ""
    return NextResponse.json({ text })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erreur IA"
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
