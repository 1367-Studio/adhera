import Anthropic from "@anthropic-ai/sdk"
import OpenAI from "openai"
import { prisma } from "@/lib/prisma/client"

// Groq, OpenAI and Mistral expose an OpenAI-compatible REST API, so one SDK client covers
// the three — only the base URL and default model differ. Anthropic speaks its own Messages
// API and gets its own SDK client (see resolveAiConfig / getAnthropicConfig below).
// Ported from eduwise's src/lib/ai/client.ts.
const PROVIDER_URLS: Record<string, string> = {
  groq:    "https://api.groq.com/openai/v1",
  openai:  "https://api.openai.com/v1",
  mistral: "https://api.mistral.ai/v1",
}

export const ANTHROPIC_PROVIDER = "anthropic"

export type AiProvider = "groq" | "openai" | "mistral" | "anthropic"

// Exported (rather than kept private) so /api/ai/config can hand it to the settings UI —
// a hand-duplicated copy there would silently go stale the moment a default changes here.
export const DEFAULT_MODELS: Record<AiProvider, string> = {
  // llama-3.3-70b-versatile was deprecated by Groq on 2026-08-16; openai/gpt-oss-120b is
  // their recommended replacement (closest capability match to the retired 70B model).
  groq:      "openai/gpt-oss-120b",
  openai:    "gpt-4o-mini",
  mistral:   "mistral-small-latest",
  anthropic: "claude-opus-5",
}

export const SUPPORTED_PROVIDERS = [...Object.keys(PROVIDER_URLS), ANTHROPIC_PROVIDER] as AiProvider[]

export function isAnthropicProvider(provider: string | null | undefined): boolean {
  return provider === ANTHROPIC_PROVIDER
}

// Platform-level fallback client (used when an association hasn't configured its own key)
// — Groq specifically, on purpose: genuinely free tier (no card required), fastest of the
// three, and cheapest if usage ever needs the paid tier. Unlike eduwise, this never
// switches provider by environment. There is deliberately no platform Anthropic key: the
// conversational assistant only runs on an association's own Anthropic key.
export const GROQ_MODEL = DEFAULT_MODELS.groq

export const platformClient = process.env.GROQ_API_KEY
  ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: PROVIDER_URLS.groq })
  : null

export type AiConfig = { provider: string; apiKey: string; model?: string | null }

// OpenAI-compatible providers (Groq, OpenAI, Mistral) — one SDK client for the three.
export type ResolvedAiConfig = { client: OpenAI; model: string; usingPlatform: boolean }

export type ResolvedAnthropicConfig = { client: Anthropic; model: string }

// Either kind, discriminated — what src/lib/ai/complete.ts consumes.
export type ResolvedAnyAiConfig =
  | ({ kind: "openai-compatible"; provider: AiProvider } & ResolvedAiConfig)
  | ({ kind: "anthropic"; provider: "anthropic"; usingPlatform: false } & ResolvedAnthropicConfig)

export function makeAiClient(config: AiConfig): { client: OpenAI; model: string } {
  const baseURL = PROVIDER_URLS[config.provider] ?? PROVIDER_URLS.groq
  return {
    client: new OpenAI({ apiKey: config.apiKey, baseURL }),
    model:  config.model || DEFAULT_MODELS[config.provider as AiProvider] || DEFAULT_MODELS.groq,
  }
}

// One retry only: the assistant loop runs several calls inside one request under an overall
// abort budget (src/lib/assistant/run-assistant.ts), so a stuck call must fail fast rather
// than retry its way past the route's maxDuration.
export function makeAnthropicClient(config: AiConfig): ResolvedAnthropicConfig {
  return {
    client: new Anthropic({ apiKey: config.apiKey, timeout: 45_000, maxRetries: 1 }),
    model:  config.model || DEFAULT_MODELS.anthropic,
  }
}

async function loadAiSettings(associationId: string) {
  return prisma.association.findUnique({
    where:  { id: associationId },
    select: { aiProvider: true, aiApiKey: true, aiModel: true },
  })
}

// Shared "own key or platform fallback" resolver for every AI feature (PDF import, meeting
// summaries, AI writing assist, content translation, help assistant). `usingPlatform` lets
// callers gate their own rate-limiting the same way: only throttle associations riding on
// the shared key.
export async function resolveAiConfig(associationId: string): Promise<ResolvedAnyAiConfig | null> {
  const assoc = await loadAiSettings(associationId)

  if (assoc?.aiApiKey) {
    const provider = (assoc.aiProvider ?? "groq") as AiProvider
    if (isAnthropicProvider(provider)) {
      return { kind: "anthropic", provider: "anthropic", usingPlatform: false, ...makeAnthropicClient({ provider, apiKey: assoc.aiApiKey, model: assoc.aiModel }) }
    }
    return { kind: "openai-compatible", provider, usingPlatform: false, ...makeAiClient({ provider, apiKey: assoc.aiApiKey, model: assoc.aiModel }) }
  }

  return platformClient
    ? { kind: "openai-compatible", provider: "groq", client: platformClient, model: GROQ_MODEL, usingPlatform: true }
    : null
}

// Meeting transcription (src/app/api/meetings/[id]/transcribe/route.ts) only ever talks to
// Groq's Whisper endpoint — Mistral has no audio transcription API at all, and OpenAI's
// Whisper uses a different model name/response shape. Rather than silently mis-routing a
// non-Groq BYOK key there, that route always uses this (the association's own key only
// when they're actually on Groq, platform key otherwise).
export function makeGroqClient(apiKey: string) {
  return new OpenAI({ apiKey, baseURL: PROVIDER_URLS.groq })
}
