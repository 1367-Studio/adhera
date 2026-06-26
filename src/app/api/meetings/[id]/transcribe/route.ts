import { NextResponse } from "next/server"
import { GetObjectCommand } from "@aws-sdk/client-s3"
import { getAssociationCtx, isCtx } from "@/lib/api-association"
import { prisma } from "@/lib/prisma/client"
import { r2 } from "@/lib/r2"
import { makeGroqClient, platformClient } from "@/lib/ai/client"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]
const MAX_BYTES = 25 * 1024 * 1024

// POST — transcribe via Groq Whisper
// Accepts either a multipart audio file OR uses the meeting's R2 recordingKey
export async function POST(
  req: Request,
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
      select: { aiApiKey: true },
    }),
  ])

  if (!meeting) return NextResponse.json({ error: "Réunion introuvable" }, { status: 404 })

  const client = assoc?.aiApiKey ? makeGroqClient(assoc.aiApiKey) : platformClient
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

    return NextResponse.json({ transcript })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erreur transcription"
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
