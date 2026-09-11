import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages"
import type { ResolvedAnyAiConfig } from "@/lib/ai/client"
import { normalizeAiHtml } from "@/lib/ai/normalize-html"
import { helpSourcesFrom } from "@/lib/help/retrieval"
import { buildSystemPrompt } from "@/lib/assistant/system-prompt"
import { buildTools } from "@/lib/assistant/tools"
import type { AssistantMessage, AssistantReply, AssistantUsage, ToolContext } from "@/lib/assistant/types"

type AnthropicAiConfig = Extract<ResolvedAnyAiConfig, { kind: "anthropic" }>

// Adaptive thinking shares this budget with the visible answer, so it is sized for a long
// table plus some reasoning. The whole loop is also bounded by an abort budget that stays
// under the route's maxDuration, whatever the per-request client timeout and retries do.
const MAX_TOKENS       = 4096
const MAX_ITERATIONS   = 6
const RUN_BUDGET_MS    = 50_000

const TRUNCATED_ANSWER_NOTICE_HTML =
  "<p><em>Réponse tronquée : précisez votre question ou demandez une liste plus courte.</em></p>"

const INCOMPLETE_ANSWER_HTML =
  "<p>Je n'ai pas pu terminer ma recherche dans le temps imparti. Pouvez-vous reformuler ou préciser votre question ?</p>"
const REFUSED_ANSWER_HTML =
  "<p>Je ne peux pas répondre à cette demande. N'hésitez pas à poser une autre question sur votre association ou sur Formwise.</p>"

function addUsage(total: AssistantUsage, message: BetaMessage, iteration: number): void {
  const { usage } = message
  const cacheCreation = usage.cache_creation_input_tokens ?? 0
  const cacheRead     = usage.cache_read_input_tokens ?? 0
  total.inputTokens       += usage.input_tokens + cacheCreation + cacheRead
  total.cachedInputTokens += cacheRead
  total.outputTokens      += usage.output_tokens
  console.info(
    `[assistant] iteration=${iteration} stop_reason=${message.stop_reason} input_tokens=${usage.input_tokens} ` +
    `cache_creation_input_tokens=${cacheCreation} cache_read_input_tokens=${cacheRead} output_tokens=${usage.output_tokens}`,
  )
}

function textOf(message: BetaMessage): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim()
}

function answerHtmlOf(finalMessage: BetaMessage): string {
  if (finalMessage.stop_reason === "refusal") return REFUSED_ANSWER_HTML
  // The runner stops at max_iterations even if the model is still asking for tools — the
  // last message is then a tool_use turn with no answer text worth showing.
  if (finalMessage.stop_reason === "tool_use") return INCOMPLETE_ANSWER_HTML
  const text = textOf(finalMessage)
  if (!text) return INCOMPLETE_ANSWER_HTML
  // A cut-off table still renders (the browser-side sanitiser closes open tags); the notice
  // tells the reader the list is partial instead of letting it pass for complete.
  return finalMessage.stop_reason === "max_tokens"
    ? normalizeAiHtml(text) + TRUNCATED_ANSWER_NOTICE_HTML
    : normalizeAiHtml(text)
}

// Copilot mode: one tool-runner loop over the association's data on the association's own
// Anthropic key. Anthropic API errors propagate to the route, which maps them to HTTP codes.
export async function runAssistant(input: {
  anthropic:       AnthropicAiConfig
  associationName: string
  context:         ToolContext
  messages:        AssistantMessage[]
}): Promise<AssistantReply> {
  const { context } = input
  const tools = buildTools(context)
  const systemPrompt = buildSystemPrompt({
    associationName: input.associationName,
    role:            context.role,
    locale:          context.locale,
    today:           context.today,
    modules:         context.modules,
    toolNames:       tools.map((tool) => tool.name),
  })

  // The system block carries an explicit cache breakpoint (tools + system are the stable
  // prefix); the top-level cache_control adds the automatic breakpoint on the conversation
  // tail so multi-turn follow-ups reuse the previous turns too. No temperature/top_p/thinking:
  // Opus 5 rejects the former and defaults to adaptive thinking for the latter.
  const runner = input.anthropic.client.beta.messages.toolRunner({
    model:      input.anthropic.model,
    max_tokens: MAX_TOKENS,
    system:     [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
    tools,
    messages:   input.messages.map((message) => ({ role: message.role, content: message.content })),
    cache_control:  { type: "ephemeral" },
    max_iterations: MAX_ITERATIONS,
    output_config:  { effort: "medium" },
  }, { signal: AbortSignal.timeout(RUN_BUDGET_MS) })

  const toolsUsed: string[] = []
  const usage: AssistantUsage = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 }
  let iteration = 0

  for await (const message of runner) {
    iteration += 1
    addUsage(usage, message, iteration)
    for (const block of message.content) {
      if (block.type === "tool_use" && !toolsUsed.includes(block.name)) toolsUsed.push(block.name)
    }
  }
  const finalMessage = await runner.done()

  return {
    mode:      "copilot",
    answer:    answerHtmlOf(finalMessage),
    sources:   helpSourcesFrom(context.collectedHelpHits),
    toolsUsed,
    usage,
  }
}
