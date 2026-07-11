import { NextResponse } from "next/server"
import { GetObjectCommand } from "@aws-sdk/client-s3"
import { prisma } from "@/lib/prisma/client"
import { r2 } from "@/lib/r2"
import { makeGroqClient, platformClient } from "@/lib/ai/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { rateLimit } from "@/lib/rate-limit"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]
const MAX_BYTES = 25 * 1024 * 1024

// POST — transcribe via Groq Whisper
// Accepts either a multipart audio file OR uses the meeting's R2 recordingKey
export const POST = withAdminAuth<{ id: string }>(async (req, ctx, { id }) => {
  const { associationId } = ctx

  const [meeting, assoc] = await Promise.all([
    prisma.meeting.findFirst({ where: { id, associationId } }),
    prisma.association.findUnique({
      where:  { id: associationId },
      select: { aiProvider: true, aiApiKey: true },
    }),
  ])

  if (!meeting) return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 })

  // Transcription only ever runs against Groq's Whisper endpoint (see src/lib/ai/client.ts)
  // — an association whose BYOK is OpenAI/Mistral doesn't have a matching key for this, so
  // it falls back to the platform's Groq key here specifically, same as having no key at all.
  const ownGroqKey = assoc?.aiApiKey && (assoc.aiProvider ?? "groq") === "groq" ? assoc.aiApiKey : null

  // Groq's whole free tier for Whisper is 2,000 requests/day, shared across every
  // association riding the platform key — a per-association limit alone doesn't protect
  // that shared budget (one association sustaining even this tighter limit could still use
  // 3*24=72/day, a small slice of it). The platform-wide bucket below is what actually
  // keeps the account under Groq's cap; the per-association one just stops a single runaway
  // caller from eating the whole platform budget alone.
  if (!ownGroqKey) {
    if (!(await rateLimit(`ai-transcribe:${associationId}`, 3, 60 * 60_000))) {
      return NextResponse.json({ error: "Trop de requêtes, réessayez plus tard." }, { status: 429 })
    }
    if (!(await rateLimit("ai-transcribe:platform", 100, 24 * 60 * 60_000))) {
      return NextResponse.json(
        { error: "Le quota de transcription de la plateforme est atteint pour aujourd'hui. Réessayez demain, ou configurez votre propre clé Groq dans Paramètres → IA." },
        { status: 429 },
      )
    }
  }

  const client = ownGroqKey ? makeGroqClient(ownGroqKey) : platformClient
  if (!client) {
    return NextResponse.json({ error: "Aucune clé API IA configurée." }, { status: 503 })
  }

  let audioFile: File

  const contentType = req.headers.get("content-type") ?? ""
  if (contentType.includes("multipart/form-data")) {
    // Direct file upload
    const formData = await req.formData()
    const file = formData.get("audio") as File | null
    if (!file) return NextResponse.json({ error: "Fichier audio requis" }, { status: 422 })
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: "Fichier trop volumineux (max 25 Mo)" }, { status: 422 })
    }
    audioFile = file
  } else {
    // Use the R2 recording
    if (!meeting.recordingKey) {
      return NextResponse.json({ error: "Aucun enregistrement disponible." }, { status: 422 })
    }
    try {
      const obj = await r2.send(new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key:    meeting.recordingKey,
      }))
      if (!obj.Body) throw new Error("Empty body")
      const bytes  = await obj.Body.transformToByteArray()
      const buffer = Buffer.from(bytes)
      const blob   = new Blob([buffer], { type: "audio/ogg" })
      const name  = meeting.recordingKey.split("/").pop() ?? "recording.ogg"
      audioFile   = new File([blob], name, { type: "audio/ogg" })
    } catch {
      return NextResponse.json(
        { error: "Enregistrement introuvable. Le fichier est peut-être encore en cours de finalisation, attendez quelques secondes." },
        { status: 404 },
      )
    }
  }

  try {
    const result = await client.audio.transcriptions.create({
      file:            audioFile,
      model:           "whisper-large-v3",
      response_format: "text",
    })

    const transcript = typeof result === "string" ? result : (result as { text: string }).text

    await prisma.meeting.update({
      where: { id },
      data:  { transcript },
    })

    await writeActivityLog({
      associationId,
      actorId: ctx.userId,
      action:  "MEETING_TRANSCRIBED",
      entity:  "Meeting",
      entityId: id,
      label:   meeting.title,
    })

    return NextResponse.json({ transcript })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur transcription"
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}, { roles: MANAGERS, module: "reunions" })
