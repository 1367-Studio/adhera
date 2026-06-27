import { NextResponse } from "next/server"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { makeGroqClient, platformClient, GROQ_MODEL } from "@/lib/ai/client"
import { writeActivityLog } from "@/lib/activity-log"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]

const SYSTEM_PROMPT =
  "Tu es un assistant spécialisé dans la rédaction de comptes-rendus de réunions pour associations françaises. " +
  "Rédige des résumés clairs, structurés et professionnels en français. " +
  "Réponds UNIQUEMENT avec le compte-rendu, sans commentaires ni explications."

function buildPrompt(title: string, transcript: string): string {
  return `Voici la transcription d'une réunion intitulée "${title}".

Rédige un compte-rendu structuré avec les sections suivantes :
- **Résumé** : en 2-3 phrases
- **Points discutés** : liste des sujets abordés
- **Décisions prises** : liste des décisions actées
- **Actions à suivre** : tâches identifiées avec responsable si mentionné

Transcription :
${transcript}`
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await getAssociationCtx()
  if (!isCtx(ctx)) return ctx
  const { associationId, role } = ctx

  if (!MANAGERS.includes(role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { id } = await params

  const [meeting, assoc] = await Promise.all([
    prisma.meeting.findFirst({ where: { id, associationId } }),
    prisma.association.findUnique({
      where:  { id: associationId },
      select: { aiApiKey: true, aiModel: true },
    }),
  ])

  if (!meeting) return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 })
  if (!meeting.transcript?.trim()) {
    return NextResponse.json({ error: "Aucune transcription disponible." }, { status: 422 })
  }

  const client = assoc?.aiApiKey ? makeGroqClient(assoc.aiApiKey) : platformClient
  if (!client) {
    return NextResponse.json(
      { error: "Aucune clé API IA configurée." },
      { status: 503 },
    )
  }

  const model = assoc?.aiModel || GROQ_MODEL

  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: buildPrompt(meeting.title, meeting.transcript) },
      ],
      temperature: 0.4,
      max_tokens:  1500,
    })

    const summary = completion.choices[0]?.message?.content?.trim() ?? ""

    const updated = await prisma.meeting.update({
      where: { id },
      data:  { summary },
    })

    await writeActivityLog({
      associationId,
      actorId: ctx.userId,
      action:  "MEETING_SUMMARIZED",
      entity:  "Meeting",
      entityId: id,
      label:   meeting.title,
    })

    return NextResponse.json({ summary: updated.summary })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur IA"
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
