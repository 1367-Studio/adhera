import type Anthropic from "@anthropic-ai/sdk"
import type { ResolvedAnyAiConfig } from "@/lib/ai/client"
import { stripCodeFences } from "@/lib/ai/normalize-html"

// One chat completion over whichever provider the association resolved to. Groq, OpenAI and
// Mistral go through the OpenAI-compatible chat-completions endpoint; Anthropic through its
// own Messages API. The options that only one side understands (temperature, JSON mode) are
// reconciled here so call sites stay provider-agnostic.
export type ChatTurn = { role: "user" | "assistant"; content: string }

export type CompleteTextOptions = {
  system:    string
  user:      string
  // Earlier turns of a conversation, oldest first, placed between the system prompt and `user`.
  history?:  ChatTurn[]
  maxTokens: number
  // Ignored on Anthropic: Opus 5 / Sonnet 5 reject the parameter outright (400).
  temperature?: number
  // OpenAI-compatible: the native json_object response format. Anthropic has no equivalent,
  // so the system prompt gets an explicit JSON-only instruction and the answer is reduced to
  // its JSON object — callers still JSON.parse the result themselves either way.
  json?: boolean
  // Per-request override of the client's default timeout.
  timeoutMs?: number
}

// A page image sent inline (base64, no "data:" prefix). JPEG and PNG are the two formats
// every vision provider behind supportsVision (src/lib/ai/client.ts) accepts.
export type CompletionImage = { base64: string; mediaType: "image/jpeg" | "image/png" }

// Same options as a text completion, minus the conversation history: an image completion is
// always a single-shot read of the images against the instructions in `user`.
export type CompleteWithImagesOptions = Omit<CompleteTextOptions, "history"> & {
  images: CompletionImage[]
}

export type CompletionUsage  = { inputTokens: number; cachedInputTokens: number; outputTokens: number }
export type CompletionResult = { text: string; usage: CompletionUsage }

type OpenAiCompatibleConfig = Extract<ResolvedAnyAiConfig, { kind: "openai-compatible" }>
type AnthropicConfig        = Extract<ResolvedAnyAiConfig, { kind: "anthropic" }>

const JSON_ONLY_INSTRUCTION = "Réponds uniquement avec un objet JSON valide, sans texte autour ni bloc de code."

// On Claude, adaptive thinking shares max_tokens with the visible answer. These single-shot
// utility completions run at low effort (little thinking) and get this much headroom so a
// budget sized for the OpenAI path still leaves room for the whole answer.
const ANTHROPIC_THINKING_HEADROOM = 1024

export async function completeText(aiConfig: ResolvedAnyAiConfig, options: CompleteTextOptions): Promise<string> {
  return (await completeChat(aiConfig, options)).text
}

export async function completeChat(aiConfig: ResolvedAnyAiConfig, options: CompleteTextOptions): Promise<CompletionResult> {
  return aiConfig.kind === "anthropic"
    ? completeWithAnthropic(aiConfig, options)
    : completeWithOpenAiCompatible(aiConfig, options)
}

// Vision variant of completeText — the images go in the same user turn as the text, before
// it. Callers must check supportsVision(aiConfig) first: the platform's Groq model is
// text-only, and sending it images fails with a provider error rather than a clear message.
export async function completeWithImages(aiConfig: ResolvedAnyAiConfig, options: CompleteWithImagesOptions): Promise<string> {
  const result = aiConfig.kind === "anthropic"
    ? await completeWithAnthropic(aiConfig, options, options.images)
    : await completeWithOpenAiCompatible(aiConfig, options, options.images)
  return result.text
}

async function completeWithOpenAiCompatible(
  aiConfig: OpenAiCompatibleConfig,
  options:  CompleteTextOptions,
  images:   CompletionImage[] = [],
): Promise<CompletionResult> {
  // Content parts with a data URL are the one image shape OpenAI and Mistral both accept on
  // their chat-completions endpoint; a text-only turn stays a plain string as before.
  const userContent = images.length === 0
    ? options.user
    : [
        ...images.map((image) => ({
          type:      "image_url" as const,
          image_url: { url: `data:${image.mediaType};base64,${image.base64}` },
        })),
        { type: "text" as const, text: options.user },
      ]

  const completion = await aiConfig.client.chat.completions.create(
    {
      model:    aiConfig.model,
      messages: [
        { role: "system", content: options.system },
        ...(options.history ?? []).map((turn) => ({ role: turn.role, content: turn.content })),
        { role: "user",   content: userContent },
      ],
      temperature:     options.temperature,
      max_tokens:      options.maxTokens,
      response_format: options.json ? { type: "json_object" } : undefined,
    },
    options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : undefined,
  )

  return {
    text: completion.choices[0]?.message?.content?.trim() ?? "",
    usage: {
      inputTokens:       completion.usage?.prompt_tokens ?? 0,
      cachedInputTokens: completion.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      outputTokens:      completion.usage?.completion_tokens ?? 0,
    },
  }
}

async function completeWithAnthropic(
  aiConfig: AnthropicConfig,
  options:  CompleteTextOptions,
  images:   CompletionImage[] = [],
): Promise<CompletionResult> {
  const system = options.json ? `${options.system}\n\n${JSON_ONLY_INSTRUCTION}` : options.system

  // Images first, then the instructions — the order Anthropic recommends for vision prompts.
  const userContent: Anthropic.MessageParam["content"] = images.length === 0
    ? options.user
    : [
        ...images.map((image) => ({
          type:   "image" as const,
          source: { type: "base64" as const, media_type: image.mediaType, data: image.base64 },
        })),
        { type: "text" as const, text: options.user },
      ]

  // No temperature on purpose (see CompleteTextOptions); thinking stays adaptive, at low effort.
  const message = await aiConfig.client.messages.create(
    {
      model:         aiConfig.model,
      max_tokens:    options.maxTokens + ANTHROPIC_THINKING_HEADROOM,
      system,
      messages: [
        ...(options.history ?? []).map((turn) => ({ role: turn.role, content: turn.content })),
        { role: "user", content: userContent },
      ],
      output_config: { effort: "low" },
    },
    options.timeoutMs !== undefined ? { timeout: options.timeoutMs } : undefined,
  )

  if (message.stop_reason === "refusal")    throw new Error("Réponse refusée par le fournisseur IA.")
  // A cut-off answer must never pass for a complete one: an empty summary or a half JSON
  // object would otherwise be saved or parsed as if the model had finished.
  if (message.stop_reason === "max_tokens") throw new Error("Réponse tronquée par le fournisseur IA (limite de tokens atteinte).")

  const text = message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim()

  const cacheCreation = message.usage.cache_creation_input_tokens ?? 0
  const cacheRead     = message.usage.cache_read_input_tokens ?? 0

  return {
    text: options.json ? extractJsonObject(stripCodeFences(text)) : text,
    usage: {
      inputTokens:       message.usage.input_tokens + cacheCreation + cacheRead,
      cachedInputTokens: cacheRead,
      outputTokens:      message.usage.output_tokens,
    },
  }
}

// Without a native JSON mode a model may still lead with a sentence ("Voici les transactions :
// {…}") — keep the outermost object so JSON.parse at the call site sees only the payload.
function extractJsonObject(text: string): string {
  if (/^[[{]/.test(text)) return text
  const firstBrace = text.indexOf("{")
  const lastBrace  = text.lastIndexOf("}")
  return firstBrace !== -1 && lastBrace > firstBrace ? text.slice(firstBrace, lastBrace + 1) : text
}
