import { NextResponse } from "next/server"
import { GetObjectCommand } from "@aws-sdk/client-s3"
import { prisma } from "@/lib/prisma/client"
import { r2 } from "@/lib/r2"
import { makeGroqClient, platformClient } from "@/lib/ai/client"
import { writeActivityLog } from "@/lib/activity-log"
import { withAdminAuth } from "@/lib/api-wrapper"
import { rateLimit, rateLimitPeek, consumeQuota } from "@/lib/rate-limit"
import type OpenAI from "openai"
import type { MeetingRecording } from "@prisma/client"

const MANAGERS = ["ADMIN", "PRESIDENT", "TRESORIER", "SECRETAIRE"]
const MAX_BYTES = 25 * 1024 * 1024

// Groq's whisper-large-v3 free tier caps ASD (audio-seconds/day) at 28,800 (8h), shared
// across every association riding the platform's key — see console.groq.com/docs/rate-limits.
// Per-participant recording (see egress/route.ts) means a single meeting can burn through a
// large slice of that in one go (a 1h meeting with 5 participants = 18,000s = 63% of the
// whole platform's daily budget), so these two replace the old click-counting limits, which
// counted "how many times the button was pressed" instead of the audio actually sent.
const ASSOC_ASD_LIMIT_SECONDS    = 6_000   // 1h40 (1,67h) per association
const PLATFORM_ASD_LIMIT_SECONDS = 24_000  // ~17% headroom under Groq's real 28,800/day cap
const ASD_WINDOW_MS = 24 * 60 * 60_000

// Stays under Groq's 20-requests/minute cap even for a large meeting — each batch is awaited
// in full before the next one starts, so calls spread out over time instead of all firing at
// once (which, with per-participant recording, a meeting past ~20 people would hit today).
const TRANSCRIBE_BATCH_SIZE = 15

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

// A recording still "open" (endedAt null — shouldn't normally happen here, transcription
// only runs after the meeting ends) is treated as running until now, so it's never
// undercounted against the ASD budget.
function recordingDurationSeconds(recording: MeetingRecording): number {
  const end = recording.endedAt ?? new Date()
  return Math.max(0, Math.round((end.getTime() - recording.startedAt.getTime()) / 1000))
}

// Runs `fn` over `items` in fixed-size batches, awaiting each batch fully before starting
// the next — keeps concurrent requests under Groq's per-minute cap instead of firing
// everything at once (see TRANSCRIBE_BATCH_SIZE).
async function transcribeInBatches(
  recordings: (MeetingRecording & { recordingKey: string })[],
  client: OpenAI,
): Promise<PromiseSettledResult<TimedLine[]>[]> {
  const results: PromiseSettledResult<TimedLine[]>[] = []
  for (let i = 0; i < recordings.length; i += TRANSCRIBE_BATCH_SIZE) {
    const batch = recordings.slice(i, i + TRANSCRIBE_BATCH_SIZE)
    results.push(...await Promise.allSettled(batch.map(r => transcribeRecording(client, r))))
  }
  return results
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

  const client = ownGroqKey ? makeGroqClient(ownGroqKey) : platformClient
  if (!client) {
    return NextResponse.json({ error: "Aucune clé API IA configurée." }, { status: 503 })
  }

  const contentType = req.headers.get("content-type") ?? ""

  try {
    let transcript: string

    if (contentType.includes("multipart/form-data")) {
      // Direct file upload — a single external audio file, no per-speaker attribution, and
      // no known duration ahead of time (no audio parsing here) — so it's guarded by a plain
      // click limit rather than the ASD budget below, on top of the existing size cap.
      if (!ownGroqKey && !(await rateLimit(`ai-transcribe-upload:${associationId}`, 10, 60 * 60_000))) {
        return NextResponse.json({ error: "Trop de requêtes, réessayez plus tard." }, { status: 429 })
      }

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

      const totalSeconds = recordings.reduce((sum, r) => sum + recordingDurationSeconds(r), 0)

      if (!ownGroqKey) {
        const [assocUsed, platformUsed] = await Promise.all([
          rateLimitPeek(`ai-transcribe-asd:${associationId}`),
          rateLimitPeek("ai-transcribe-asd:platform"),
        ])
        if (assocUsed + totalSeconds > ASSOC_ASD_LIMIT_SECONDS) {
          return NextResponse.json(
            { error: "Quota de transcription IA atteint pour votre association aujourd'hui. Réessayez demain, ou configurez votre propre clé Groq dans Paramètres → IA." },
            { status: 429 },
          )
        }
        if (platformUsed + totalSeconds > PLATFORM_ASD_LIMIT_SECONDS) {
          return NextResponse.json(
            { error: "Le quota de transcription de la plateforme est atteint pour aujourd'hui. Réessayez demain, ou configurez votre propre clé Groq dans Paramètres → IA." },
            { status: 429 },
          )
        }
        await Promise.all([
          consumeQuota(`ai-transcribe-asd:${associationId}`, totalSeconds, ASD_WINDOW_MS),
          consumeQuota("ai-transcribe-asd:platform", totalSeconds, ASD_WINDOW_MS),
        ])
      }

      // Best-effort: a recording that's still finalizing (or that Whisper rejects) doesn't
      // block transcribing everyone else's — but instead of silently dropping it, a marker
      // line goes in at that recording's start time so the gap is visible in the transcript
      // instead of just... missing, with no trace that person was even there.
      const settled = await transcribeInBatches(recordings, client)
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
