import { NextResponse } from "next/server"
import { GetObjectCommand } from "@aws-sdk/client-s3"
import { prisma } from "@/lib/prisma/client"
import { r2 } from "@/lib/r2"
import { makeGroqClient, platformClient } from "@/lib/ai/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { rateLimit } from "@/lib/rate-limit"
import type OpenAI from "openai"
import type { MeetingRecording } from "@prisma/client"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]
const MAX_BYTES = 25 * 1024 * 1024

type TimedLine = { speaker: string; time: Date; text: string; failed?: boolean }

// Fetches one recording's audio from R2 as a File Whisper can transcribe — same
// "not finalized yet" failure mode as before, just per-recording now.
async function loadRecordingAudio(recordingKey: string): Promise<File> {
  const obj = await r2.send(new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME!,
    Key:    recordingKey,
  }))
  if (!obj.Body) throw new Error("Empty body")
  const bytes  = await obj.Body.transformToByteArray()
  const buffer = Buffer.from(bytes)
  const blob   = new Blob([buffer], { type: "audio/ogg" })
  const name   = recordingKey.split("/").pop() ?? "recording.ogg"
  return new File([blob], name, { type: "audio/ogg" })
}

// Transcribes a single participant's recording with segment timing (verbose_json) so it can
// later be merged with every other participant's, in the order things were actually said —
// a plain "text" response has no way to tell when each phrase happened.
async function transcribeRecording(client: OpenAI, recording: MeetingRecording & { recordingKey: string }): Promise<TimedLine[]> {
  const audioFile = await loadRecordingAudio(recording.recordingKey)
  const result = await client.audio.transcriptions.create({
    file:            audioFile,
    model:           "whisper-large-v3",
    response_format: "verbose_json",
  })

  return (result.segments ?? [])
    .map(s => ({
      speaker: recording.displayName,
      time:    new Date(recording.startedAt.getTime() + s.start * 1000),
      text:    s.text.trim(),
    }))
    .filter(line => line.text.length > 0)
}

function failedRecordingLine(recording: MeetingRecording): TimedLine {
  return {
    speaker: recording.displayName,
    time:    recording.startedAt,
    text:    "⚠️ Transcription indisponible pour cet enregistrement (fichier introuvable ou erreur du service).",
    failed:  true,
  }
}

// Merges every participant's timed segments into one readable transcript, chronologically —
// e.g. "[10h03] Marie : Bonjour à tous". Adjacent segments from the same speaker are folded
// into a single line, since Whisper's segments are phrase-sized on their own.
function formatTranscript(lines: TimedLine[]): string {
  const sorted = [...lines].sort((a, b) => a.time.getTime() - b.time.getTime())
  const merged: TimedLine[] = []
  for (const line of sorted) {
    const last = merged[merged.length - 1]
    if (last && last.speaker === line.speaker && !last.failed && !line.failed) {
      last.text += ` ${line.text}`
    } else {
      merged.push({ ...line })
    }
  }
  return merged
    .map(l => `[${l.time.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}] ${l.speaker} : ${l.text}`)
    .join("\n")
}


// POST — transcribe via Groq Whisper. Two modes:
//  - multipart audio upload: a single external file (e.g. recorded outside the app) — no
//    speaker attribution possible, transcribed as plain text.
//  - no body: transcribes every per-participant MeetingRecording (see egress/route.ts) and
//    merges them into one speaker-attributed, chronologically ordered transcript.
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
  // that shared budget. The platform-wide bucket below is what actually keeps the account
  // under Groq's cap; the per-association one just stops a single runaway caller from
  // eating the whole platform budget alone.
  // NB: since per-participant recording, one click here can now fan out into one Whisper
  // call per participant instead of one — these limits are per *click*, not per audio file,
  // so a bigger meeting eats more of the shared budget per use than it used to. Revisit the
  // numbers below if the platform bucket starts running dry in practice.
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

  const contentType = req.headers.get("content-type") ?? ""

  try {
    let transcript: string

    if (contentType.includes("multipart/form-data")) {
      // Direct file upload — a single external audio file, no per-speaker attribution.
      const formData = await req.formData()
      const file = formData.get("audio") as File | null
      if (!file) return NextResponse.json({ error: "Fichier audio requis" }, { status: 422 })
      if (file.size > MAX_BYTES) {
        return NextResponse.json({ error: "Fichier trop volumineux (max 25 Mo)" }, { status: 422 })
      }

      const result = await client.audio.transcriptions.create({
        file,
        model:           "whisper-large-v3",
        response_format: "text",
      })
      transcript = typeof result === "string" ? result : (result as { text: string }).text
    } else {
      // Every per-participant recording captured during the call. recordingKey is set as
      // soon as egress starts, but the file may still be finalizing in R2 for a few seconds
      // after the meeting ends — same race as before, handled per-recording now.
      const recordings = await prisma.meetingRecording.findMany({
        where: { meetingId: id, recordingKey: { not: null } },
      }) as (MeetingRecording & { recordingKey: string })[]

      if (recordings.length === 0) {
        return NextResponse.json({ error: "Aucun enregistrement disponible." }, { status: 422 })
      }

      // Best-effort: a recording that's still finalizing (or that Whisper rejects) doesn't
      // block transcribing everyone else's — but instead of silently dropping it, a marker
      // line goes in at that recording's start time so the gap is visible in the transcript
      // instead of just... missing, with no trace that person was even there.
      const settled = await Promise.allSettled(recordings.map(r => transcribeRecording(client, r)))
      const lines = settled.flatMap((result, i) =>
        result.status === "fulfilled" ? result.value : [failedRecordingLine(recordings[i])],
      )

      const allFailed = settled.every(r => r.status === "rejected")
      if (allFailed) {
        return NextResponse.json(
          { error: "Enregistrement introuvable. Le fichier est peut-être encore en cours de finalisation, attendez quelques secondes." },
          { status: 404 },
        )
      }

      transcript = formatTranscript(lines)

    }

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
