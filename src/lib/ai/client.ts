import OpenAI from "openai"

// All three expose an OpenAI-compatible REST API, so the same SDK client works for all —
// only the base URL and default model differ. Ported from eduwise's src/lib/ai/client.ts.
const PROVIDER_URLS: Record<string, string> = {
  groq:    "https://api.groq.com/openai/v1",
  openai:  "https://api.openai.com/v1",
  mistral: "https://api.mistral.ai/v1",
}

// Exported (rather than kept private) so /api/ai/config can hand it to the settings UI —
// a hand-duplicated copy there would silently go stale the moment a default changes here.
export const DEFAULT_MODELS: Record<string, string> = {
  groq:    "llama-3.3-70b-versatile",
  openai:  "gpt-4o-mini",
  mistral: "mistral-small-latest",
}

export const SUPPORTED_PROVIDERS = Object.keys(PROVIDER_URLS) as ("groq" | "openai" | "mistral")[]

// Platform-level fallback client (used when an association hasn't configured its own key)
// — Groq specifically, on purpose: genuinely free tier (no card required), fastest of the
// three, and cheapest if usage ever needs the paid tier. Unlike eduwise, this never
// switches provider by environment.
export const GROQ_MODEL = DEFAULT_MODELS.groq

export const platformClient = process.env.GROQ_API_KEY
  ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: PROVIDER_URLS.groq })
  : null

export type AiConfig = { provider: string; apiKey: string; model?: string | null }

export function makeAiClient(config: AiConfig): { client: OpenAI; model: string } {
  const baseURL = PROVIDER_URLS[config.provider] ?? PROVIDER_URLS.groq
  return {
    client: new OpenAI({ apiKey: config.apiKey, baseURL }),
    model:  config.model || DEFAULT_MODELS[config.provider] || DEFAULT_MODELS.groq,
  }
}

// Meeting transcription (src/app/api/meetings/[id]/transcribe/route.ts) only ever talks to
// Groq's Whisper endpoint — Mistral has no audio transcription API at all, and OpenAI's
// Whisper uses a different model name/response shape. Rather than silently mis-routing a
// non-Groq BYOK key there, that route always uses this (the association's own key only
// when they're actually on Groq, platform key otherwise).
export function makeGroqClient(apiKey: string) {
  return new OpenAI({ apiKey, baseURL: PROVIDER_URLS.groq })
}
