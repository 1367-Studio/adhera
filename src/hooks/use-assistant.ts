import { useMutation } from "@tanstack/react-query"
import { apiError } from "@/lib/api-error"
import type { AssistantMessage, AssistantMode, AssistantReply, AssistantUsage } from "@/lib/assistant/types"
import type { HelpModuleKey } from "@/lib/help/modules"

export type { AssistantMessage, AssistantMode, AssistantReply, AssistantUsage }

export type AssistantChatInput = { messages: AssistantMessage[]; module?: HelpModuleKey }

// Errors carry the route's code (AI_KEY_MISSING / AI_KEY_INVALID — see HELP_ERROR_CODES in
// use-help.ts) through ApiError, so the UI branches on the code, never on the message text.
async function postAssistantChat(input: AssistantChatInput): Promise<AssistantReply> {
  const res = await fetch("/api/ai/assistant", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(input),
  })
  if (!res.ok) throw await apiError(res, "Erreur IA")
  return res.json()
}

// `onSuccess` is a hook-level callback on purpose: TanStack only skips the per-call
// `mutate(..., { onSuccess })` callbacks when the component has unmounted, and the help panel
// unmounts its tabs on close — a reply that lands after the user closed the panel must still
// be committed (to sessionStorage at least), or the billed answer is simply lost.
export function useAssistantChat(options: { onSuccess?: (reply: AssistantReply, input: AssistantChatInput) => void } = {}) {
  return useMutation<AssistantReply, Error, AssistantChatInput>({ mutationFn: postAssistantChat, onSuccess: options.onSuccess })
}
