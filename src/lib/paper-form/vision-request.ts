import { NextResponse } from "next/server"
import { resolveAiConfig, supportsVision, type ResolvedAnyAiConfig } from "@/lib/ai/client"
import type { CompletionImage } from "@/lib/ai/complete"
import { guardModule } from "@/lib/auth/require-module"
import { sniffFileType } from "@/lib/file-sniff"
import { rateLimit } from "@/lib/rate-limit"
import { MAX_FUNCTION_UPLOAD_BYTES } from "@/lib/upload-limits"
import type { PaperFormPageImage } from "@/lib/schemas"

// Shared guards of the two vision routes of the paper-form import (analyze a blank form,
// extract one filled page). Each helper answers either its result or the NextResponse the
// route must return as-is.

export const VISION_NOT_SUPPORTED_MESSAGE =
  "La lecture de fiches papier nécessite une clé API Anthropic, OpenAI ou Mistral propre à " +
  "l'association (la clé de la plateforme ne lit pas les images). Configurez-la dans Paramètres → IA."

const BASE64_REGEX = /^[A-Za-z0-9+/]+={0,2}$/

// The page images arrive base64-encoded inside a JSON body, so the Vercel body cap applies
// to the whole request — checked on the declared length first (cheap rejection before
// reading anything), then on what was actually read, since Content-Length can be absent
// (chunked) or wrong.
export async function readVisionJsonBody(req: Request): Promise<{ body: unknown } | NextResponse> {
  const tooLarge = NextResponse.json({ error: "Images trop volumineuses (max 4 Mo par envoi)" }, { status: 413 })

  const declaredLength = Number(req.headers.get("content-length") ?? "0")
  if (Number.isFinite(declaredLength) && declaredLength > MAX_FUNCTION_UPLOAD_BYTES) return tooLarge

  const rawBody = await req.text()
  if (Buffer.byteLength(rawBody, "utf8") > MAX_FUNCTION_UPLOAD_BYTES) return tooLarge

  try {
    return { body: JSON.parse(rawBody) }
  } catch {
    return NextResponse.json({ error: "Requête invalide" }, { status: 400 })
  }
}

// Decodes and sniffs every page. The declared mediaType is never trusted: the real magic
// bytes decide, and anything other than JPEG/PNG is refused (a PDF must be rendered to
// images by the browser first). The returned media type is the sniffed one.
export function decodePageImages(pages: PaperFormPageImage[]): { images: CompletionImage[] } | NextResponse {
  const images: CompletionImage[] = []
  let totalDecodedBytes = 0

  for (const [pageIndex, page] of pages.entries()) {
    // Tolerate a data URL prefix and line breaks — both are easy for a client to leave in.
    const cleanedBase64 = page.base64.replace(/^data:[^;,]+;base64,/, "").replace(/\s+/g, "")
    const invalidPage = NextResponse.json({ error: `Page ${pageIndex + 1} : image JPEG ou PNG attendue` }, { status: 422 })
    if (!BASE64_REGEX.test(cleanedBase64)) return invalidPage

    const decodedBytes = Buffer.from(cleanedBase64, "base64")
    totalDecodedBytes += decodedBytes.length
    if (totalDecodedBytes > MAX_FUNCTION_UPLOAD_BYTES) {
      return NextResponse.json({ error: "Images trop volumineuses (max 4 Mo par envoi)" }, { status: 413 })
    }

    const sniffedType = sniffFileType(decodedBytes)
    if (sniffedType !== "image/jpeg" && sniffedType !== "image/png") return invalidPage

    images.push({ base64: cleanedBase64, mediaType: sniffedType })
  }

  return { images }
}

// Module gate, per-association throttle and provider check, in that order. The throttle
// applies even on the association's own key (the only one vision ever runs on): its cost is
// theirs, but each call still holds one of our functions for several seconds, and a
// runaway client loop should not be able to do that without bound.
export async function resolveVisionConfig(
  associationId: string,
  rateLimitBucket: string,
  rateLimitPerHour: number,
): Promise<{ aiConfig: ResolvedAnyAiConfig } | NextResponse> {
  const iaGuard = await guardModule(associationId, "ia")
  if (iaGuard) return iaGuard

  if (!(await rateLimit(`${rateLimitBucket}:${associationId}`, rateLimitPerHour, 60 * 60_000))) {
    return NextResponse.json({ error: "Trop de requêtes, réessayez plus tard." }, { status: 429 })
  }

  const aiConfig = await resolveAiConfig(associationId)
  if (!aiConfig || !supportsVision(aiConfig)) {
    // `code` lets the UI tell "no vision-capable key" (→ link to the AI settings) from any
    // other 422.
    return NextResponse.json({ error: VISION_NOT_SUPPORTED_MESSAGE, code: "VISION_NOT_SUPPORTED" }, { status: 422 })
  }

  return { aiConfig }
}

// Same prompt-only JSON contract as src/app/api/finances/import/parse-pdf/route.ts: the
// model's answer is data to validate, never trusted as-is.
export function parseModelJson(text: string): unknown {
  try {
    return JSON.parse(text || "{}")
  } catch {
    return null
  }
}
