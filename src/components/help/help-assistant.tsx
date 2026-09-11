"use client"

import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import Link from "next/link"
import { useTranslations } from "next-intl"
import { canAccessDashboardRoute } from "@/components/layout/app-sidebar"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RichTextView } from "@/components/ui/rich-text-view"
import { useSidebar } from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { useAssistantChat, type AssistantMessage, type AssistantMode } from "@/hooks/use-assistant"
import { HELP_ERROR_CODES } from "@/hooks/use-help"
import { ApiError } from "@/lib/api-error"
import type { HelpModuleKey } from "@/lib/help/modules"
import { useCurrentUser } from "@/lib/user-context"
import { cn } from "@/lib/utils"
import type { HelpContentType, HelpSource } from "@/sanity/types"

// Mirrors the route's zod content(1..4000): the field stops at the cap instead of letting the
// server reject a long paste.
const QUESTION_MAX_LENGTH   = 4000
// The counter only earns its pixels once the cap is within reach.
const COUNTER_VISIBLE_FROM  = QUESTION_MAX_LENGTH - 400
// Exactly what the server keeps after its own truncation, so the payload never carries turns
// the model will not see anyway (12 history messages + the new question = 13, zod max 20).
const HISTORY_MESSAGE_LIMIT = 12
// 10 exchanges = the 20 stored messages the contract caps sessionStorage at.
const STORED_EXCHANGE_LIMIT = 10
const STORAGE_VERSION       = 1
// Its hits are already reported by the "Sources" line — naming it under "Données consultées"
// would report the same thing twice.
const DOCS_TOOL_NAME        = "search_help_docs"
const SETTINGS_HREF         = "/dashboard/parametres?tab=integrations"

// The panel's section-label style (FAQ, Aide tab): hierarchy from typography, not containers.
const LABEL_CLASSES = "text-xs font-medium uppercase tracking-wide text-muted-foreground"
/** One question and the answer it got. The transcript is a list of these. */
type CompletedExchange = {
  question:  string
  answer:    string
  toolsUsed: string[]
  sources:   HelpSource[]
}

type StoredMessage =
  | { role: "user";      content: string }
  | { role: "assistant"; content: string; toolsUsed: string[]; sources: HelpSource[] }

type StoredConversation = {
  version:  number
  mode:     AssistantMode | null
  messages: StoredMessage[]
}

type RestoredConversation = {
  mode:      AssistantMode | null
  exchanges: CompletedExchange[]
}

const EMPTY_CONVERSATION: RestoredConversation = { mode: null, exchanges: [] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isAssistantMode(value: unknown): value is AssistantMode {
  return value === "copilot" || value === "docs"
}

/** Without an association there is nothing to scope the history to — it stays in memory. */
function storageKeyFor(associationId: string | null | undefined): string | null {
  return associationId ? `formwise:assistant:${associationId}` : null
}

// Nothing from storage is trusted beyond this shape check; the answer HTML still goes through
// RichTextView's sanitiser on render.
function parseStoredSources(value: unknown): HelpSource[] | null {
  if (!Array.isArray(value)) return null
  const sources: HelpSource[] = []
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.title !== "string") return null
    sources.push({
      title:  entry.title,
      slug:   typeof entry.slug   === "string" ? entry.slug : null,
      module: typeof entry.module === "string" ? (entry.module as HelpModuleKey) : null,
      type:   entry.type === "faqEntry" ? "faqEntry" : ("helpArticle" as HelpContentType),
    })
  }
  return sources
}

function parseStoredToolNames(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  return value.every(entry => typeof entry === "string") ? (value as string[]) : null
}

/**
 * Reads the conversation of this browser tab. Malformed JSON, another `version` or anything
 * that is not a strict user/assistant pairing starts an empty transcript rather than a
 * half-restored one.
 */
function readStoredConversation(storageKey: string | null): RestoredConversation {
  if (!storageKey || typeof window === "undefined") return EMPTY_CONVERSATION

  let rawConversation: string | null = null
  try {
    rawConversation = window.sessionStorage.getItem(storageKey)
  } catch {
    // Private mode or storage disabled — the transcript is in-memory for this session.
    return EMPTY_CONVERSATION
  }
  if (!rawConversation) return EMPTY_CONVERSATION

  try {
    const parsed: unknown = JSON.parse(rawConversation)
    if (!isRecord(parsed) || parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.messages)) {
      return EMPTY_CONVERSATION
    }

    const storedMessages = parsed.messages
    const exchanges: CompletedExchange[] = []
    for (let index = 0; index + 1 < storedMessages.length; index += 2) {
      const userMessage      = storedMessages[index]
      const assistantMessage = storedMessages[index + 1]
      if (!isRecord(userMessage) || userMessage.role !== "user" || typeof userMessage.content !== "string") {
        return EMPTY_CONVERSATION
      }
      if (!isRecord(assistantMessage) || assistantMessage.role !== "assistant" || typeof assistantMessage.content !== "string") {
        return EMPTY_CONVERSATION
      }
      const toolsUsed = parseStoredToolNames(assistantMessage.toolsUsed)
      const sources   = parseStoredSources(assistantMessage.sources)
      if (!toolsUsed || !sources) return EMPTY_CONVERSATION

      exchanges.push({ question: userMessage.content, answer: assistantMessage.content, toolsUsed, sources })
    }

    return { mode: isAssistantMode(parsed.mode) ? parsed.mode : null, exchanges }
  } catch {
    return EMPTY_CONVERSATION
  }
}

/** Written after each successful reply only — a pending or failed question is never stored. */
function writeStoredConversation(storageKey: string | null, exchanges: CompletedExchange[], mode: AssistantMode | null) {
  if (!storageKey) return
  // Dropping whole exchanges keeps the array starting with a user message and the pairs intact.
  const storedMessages: StoredMessage[] = exchanges.slice(-STORED_EXCHANGE_LIMIT).flatMap(exchange => [
    { role: "user"      as const, content: exchange.question },
    { role: "assistant" as const, content: exchange.answer, toolsUsed: exchange.toolsUsed, sources: exchange.sources },
  ])
  const conversation: StoredConversation = { version: STORAGE_VERSION, mode, messages: storedMessages }
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(conversation))
  } catch {
    // Private mode or quota — the transcript simply does not survive a reload.
  }
}

function clearStoredConversation(storageKey: string | null) {
  if (!storageKey) return
  try {
    window.sessionStorage.removeItem(storageKey)
  } catch {
    // Nothing to clean up when storage is unavailable.
  }
}

interface HelpAssistantProps {
  module:        HelpModuleKey
  /** The panel keeps this tab mounted; true only while it is the visible one. */
  isActive:      boolean
  /** Opens a cited source in the Aide tab. */
  onOpenArticle: (slug: string) => void
  /** The Paramètres link navigates away — the modal sheet has to close first. */
  onClosePanel:  () => void
}

export function HelpAssistant({ module, isActive, onOpenArticle, onClosePanel }: HelpAssistantProps) {
  const t            = useTranslations("help")
  const currentUser  = useCurrentUser()
  const { isMobile } = useSidebar()

  const storageKey = storageKeyFor(currentUser.associationId)

  // Read during the first render rather than from an effect: the panel is loaded with
  // `ssr: false` and only mounted once the help button is clicked, so there is no server
  // snapshot to mismatch — and no cascading re-render on every open.
  const [restoredConversation] = useState<RestoredConversation>(() => readStoredConversation(storageKey))

  const [completedExchanges, setCompletedExchanges] = useState<CompletedExchange[]>(restoredConversation.exchanges)
  // Configuration knowledge, not conversation: it outlives "Nouvelle conversation".
  const [assistantMode, setAssistantMode]           = useState<AssistantMode | null>(restoredConversation.mode)
  const [draft, setDraft]                           = useState("")
  // The question of the exchange that is loading or has failed — the only one of either kind.
  const [pendingQuestion, setPendingQuestion]       = useState<string | null>(null)
  // Bumped by every send and retry; the scroll-to-bottom rule keys off it rather than off the
  // transcript itself, so an arriving answer never moves the viewport.
  const [sendSequence, setSendSequence]             = useState(0)

  const transcriptRef = useRef<HTMLDivElement>(null)
  const composerRef   = useRef<HTMLTextAreaElement>(null)

  // Refs mirror the state the reply commit needs: the hook-level onSuccess (see
  // useAssistantChat) can run after this component unmounted, when state setters are no-ops
  // but sessionStorage must still receive the exchange.
  const completedExchangesRef = useRef<CompletedExchange[]>(restoredConversation.exchanges)
  const assistantChat = useAssistantChat({
    onSuccess: (reply, input) => {
      const question = input.messages[input.messages.length - 1]?.content ?? ""
      const nextExchanges = [...completedExchangesRef.current, {
        question,
        answer:    reply.answer,
        toolsUsed: reply.toolsUsed,
        sources:   reply.sources,
      }]
      completedExchangesRef.current = nextExchanges
      writeStoredConversation(storageKey, nextExchanges, reply.mode)
      setCompletedExchanges(nextExchanges)
      setAssistantMode(reply.mode)
      setPendingQuestion(null)
      focusComposerOnDesktop()
    },
  })
  const isPending     = assistantChat.isPending
  // Once the mutation settles with the question still pending, it settled with an error.
  const failedError   = !isPending && pendingQuestion !== null ? assistantChat.error : null
  const hasTranscript = completedExchanges.length > 0 || pendingQuestion !== null

  // Whoever cannot open Paramètres is told to ask an administrator instead of getting a link
  // to a page that would redirect them.
  const canConfigureApiKey = canAccessDashboardRoute(currentUser.role, "/dashboard/parametres")

  const scrollTranscriptToBottom = useCallback(() => {
    const transcriptElement = transcriptRef.current
    if (!transcriptElement) return
    // Instant: a long answer sliding past would be motion for its own sake.
    transcriptElement.scrollTop = transcriptElement.scrollHeight
  }, [])

  // The user just sent (or retried): their question and the loading slot must be in view.
  useLayoutEffect(() => {
    if (sendSequence === 0) return
    scrollTranscriptToBottom()
  }, [sendSequence, scrollTranscriptToBottom])

  // Restored history, and every return to the tab: `keepMounted` hides the panel with
  // display:none, which loses the scroll position — the newest exchange is the better landing
  // place than the top.
  useEffect(() => {
    if (!isActive || !hasTranscript) return
    scrollTranscriptToBottom()
  }, [isActive, hasTranscript, scrollTranscriptToBottom])

  function focusComposerOnDesktop() {
    // A re-focus on mobile pops the keyboard over the answer.
    if (isMobile) return
    composerRef.current?.focus()
  }

  // `fromComposer` clears the draft at send time; a retry of a failed exchange must leave
  // whatever the user has typed in the meantime untouched.
  function sendQuestion(question: string, options: { fromComposer: boolean }) {
    const trimmedQuestion = question.trim()
    if (trimmedQuestion.length === 0 || isPending) return

    // `completedExchanges` cannot change while a request is in flight (only a reply appends to
    // it, and the composer is disabled meanwhile), so this closure holds the current history.
    const historyMessages: AssistantMessage[] = completedExchanges.flatMap(exchange => [
      { role: "user"      as const, content: exchange.question },
      { role: "assistant" as const, content: exchange.answer },
    ])
    const payloadMessages: AssistantMessage[] = [
      ...historyMessages.slice(-HISTORY_MESSAGE_LIMIT),
      { role: "user", content: trimmedQuestion },
    ]

    setPendingQuestion(trimmedQuestion)
    setSendSequence(sequence => sequence + 1)
    if (options.fromComposer) setDraft("")

    completedExchangesRef.current = completedExchanges
    assistantChat.mutate({ messages: payloadMessages, module })
  }

  function startNewConversation() {
    completedExchangesRef.current = []
    setCompletedExchanges([])
    setPendingQuestion(null)
    setDraft("")
    assistantChat.reset()
    clearStoredConversation(storageKey)
    focusComposerOnDesktop()
  }

  // Prefills without sending: every billable request stays behind an explicit "Envoyer".
  function prefillQuestion(exampleText: string) {
    setDraft(exampleText)
    // The caret can only be placed once React has committed the new value.
    window.requestAnimationFrame(() => {
      const composerElement = composerRef.current
      if (!composerElement) return
      composerElement.focus()
      composerElement.setSelectionRange(exampleText.length, exampleText.length)
    })
  }

  const canSend     = draft.trim().length > 0 && !isPending
  const showCounter = draft.length >= COUNTER_VISIBLE_FROM

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {hasTranscript && (
        <div className="flex shrink-0 items-center justify-end px-4 pt-2">
          <Button variant="ghost" size="sm" onClick={startNewConversation} disabled={isPending}>
            {t("assistant.newConversation")}
          </Button>
        </div>
      )}

      <div
        ref={transcriptRef}
        role="log"
        aria-live="polite"
        aria-busy={isPending}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {!hasTranscript ? (
          <AssistantEmptyState mode={assistantMode} onPrefill={prefillQuestion} />
        ) : (
          <ol className="divide-y divide-border/60 px-4">
            {completedExchanges.map((exchange, index) => (
              <li key={index} className="flex flex-col gap-3 py-4">
                <AssistantQuestion question={exchange.question} />
                <div>
                  <p className={LABEL_CLASSES}>{t("assistant.assistantLabel")}</p>
                  <RichTextView content={exchange.answer} className="mt-1.5" />
                  <AssistantAnswerFooter
                    toolsUsed={exchange.toolsUsed}
                    sources={exchange.sources}
                    onOpenArticle={onOpenArticle}
                  />
                </div>
              </li>
            ))}

            {pendingQuestion !== null && (
              <li className="flex flex-col gap-3 py-4">
                <AssistantQuestion question={pendingQuestion} />
                <div>
                  <p className={LABEL_CLASSES}>{t("assistant.assistantLabel")}</p>
                  {failedError ? (
                    <AssistantFailure
                      error={failedError}
                      canConfigureApiKey={canConfigureApiKey}
                      onClosePanel={onClosePanel}
                      onRetry={() => sendQuestion(pendingQuestion, { fromComposer: false })}
                    />
                  ) : (
                    <AssistantPendingAnswer mode={assistantMode} />
                  )}
                </div>
              </li>
            )}
          </ol>
        )}
      </div>

      <div className="shrink-0 border-t px-4 py-3">
        {assistantMode === "docs" && (
          <p className="mb-2 text-xs text-muted-foreground">
            {t("assistant.docsOnlyNotice")}{" "}
            {canConfigureApiKey && (
              <Link
                href={SETTINGS_HREF}
                className="underline underline-offset-4 hover:text-foreground"
                onClick={onClosePanel}
              >
                {t("assistant.docsOnlyConfigure")}
              </Link>
            )}
          </p>
        )}

        <div className="flex items-end gap-2">
          <Label htmlFor="help-assistant-question" className="sr-only">
            {t("assistant.questionLabel")}
          </Label>
          <Textarea
            id="help-assistant-question"
            ref={composerRef}
            rows={1}
            className="min-h-9 max-h-40 flex-1 py-1.5"
            maxLength={QUESTION_MAX_LENGTH}
            placeholder={t("assistant.questionPlaceholder")}
            value={draft}
            disabled={isPending}
            aria-keyshortcuts="Control+Enter Meta+Enter"
            onChange={event => setDraft(event.target.value)}
            // Questions are multi-clause and every send is a billable request against the
            // association's own key, so plain Enter inserts a newline and the modifier sends.
            onKeyDown={event => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault()
                sendQuestion(draft, { fromComposer: true })
              }
            }}
          />
          <Button
            onClick={() => sendQuestion(draft, { fromComposer: true })}
            loading={isPending}
            disabled={!canSend}
            title={t("assistant.sendShortcut")}
          >
            {t("assistant.send")}
          </Button>
        </div>

        <p className="mt-1.5 flex items-baseline justify-between gap-3 text-xs text-muted-foreground">
          <span>{t("assistant.disclaimer")}</span>
          {showCounter && (
            <span className="shrink-0 tabular-nums">
              {t("assistant.charactersCount", { count: draft.length, max: QUESTION_MAX_LENGTH })}
            </span>
          )}
        </p>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- Transcript */

function AssistantQuestion({ question }: { question: string }) {
  const t = useTranslations("help")
  return (
    <div>
      <p className={LABEL_CLASSES}>{t("assistant.youLabel")}</p>
      {/* The label already sets the message apart — medium weight would read as a heading.
          `break-words` keeps a pasted URL from widening the panel. */}
      <p className="mt-1.5 text-sm whitespace-pre-wrap break-words text-foreground">{question}</p>
    </div>
  )
}

interface AssistantAnswerFooterProps {
  toolsUsed:     string[]
  sources:       HelpSource[]
  onOpenArticle: (slug: string) => void
}

function AssistantAnswerFooter({ toolsUsed, sources, onOpenArticle }: AssistantAnswerFooterProps) {
  const t = useTranslations("help")

  // De-duplicated after mapping, not before: two tools share the "Membres" label. A tool added
  // later without a label renders raw — ugly on purpose, so it is caught in review.
  const dataLabels: string[] = []
  for (const toolName of toolsUsed) {
    if (toolName === DOCS_TOOL_NAME) continue
    const toolLabelKey = `assistant.tools.${toolName}`
    const toolLabel    = t.has(toolLabelKey) ? t(toolLabelKey) : toolName
    if (!dataLabels.includes(toolLabel)) dataLabels.push(toolLabel)
  }

  if (dataLabels.length === 0 && sources.length === 0) return null

  return (
    <div className="mt-3 space-y-1 text-xs text-muted-foreground">
      {dataLabels.length > 0 && (
        <p>{t("assistant.dataConsulted")} {dataLabels.join(", ")}</p>
      )}
      {sources.length > 0 && (
        <p>
          {t("assistant.sources")}{" "}
          {sources.map((source, index) => {
            const articleSlug = source.slug
            return (
              <Fragment key={`${source.type}-${articleSlug ?? source.title}-${index}`}>
                {index > 0 && ", "}
                {articleSlug ? (
                  <button
                    type="button"
                    className="underline underline-offset-4 hover:text-foreground"
                    onClick={() => onOpenArticle(articleSlug)}
                  >
                    {source.title}
                  </button>
                ) : (
                  <span>{source.title}</span>
                )}
              </Fragment>
            )
          })}
        </p>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ States */

function AssistantEmptyState({ mode, onPrefill }: { mode: AssistantMode | null; onPrefill: (text: string) => void }) {
  const t = useTranslations("help")

  // A docs-only association must not be offered "Qui n'a pas payé sa cotisation ?" as its
  // first click — that example would end in a refusal by design.
  const examples = mode === "docs"
    ? [
        { key: "reminder",    text: t("assistant.examplesDocs.reminder") },
        { key: "export",      text: t("assistant.examplesDocs.export") },
        { key: "createEvent", text: t("assistant.examplesDocs.createEvent") },
      ]
    : [
        { key: "unpaid",      text: t("assistant.examples.unpaid") },
        { key: "donations",   text: t("assistant.examples.donations") },
        { key: "createEvent", text: t("assistant.examples.createEvent") },
      ]

  return (
    <div className="px-4 py-4">
      <p className="text-sm text-muted-foreground">
        {mode === "docs" ? t("assistant.introDocs") : t("assistant.intro")}
      </p>
      <p className={cn("mt-5", LABEL_CLASSES)}>{t("assistant.examplesLabel")}</p>
      {/* -ml-2.5 cancels the sm button's padding so the questions align with the label. */}
      <div className="-ml-2.5 mt-1 flex flex-col items-start">
        {examples.map(example => (
          <Button
            key={example.key}
            variant="ghost"
            size="sm"
            className="h-auto justify-start whitespace-normal py-1.5 text-left font-normal text-foreground"
            onClick={() => onPrefill(example.text)}
          >
            {example.text}
          </Button>
        ))}
      </div>
    </div>
  )
}

function AssistantPendingAnswer({ mode }: { mode: AssistantMode | null }) {
  const t = useTranslations("help")
  return (
    <>
      {/* "Consultation des données…" only once copilot mode is known: for a docs-only
          association it would be false, and "Rédaction…" is true in both modes. */}
      <p className="mt-1.5 text-sm text-muted-foreground">
        {mode === "copilot" ? t("assistant.loadingCopilot") : t("assistant.loadingDocs")}
      </p>
      <div className="mt-2 space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </>
  )
}

interface AssistantFailureProps {
  error:              Error
  canConfigureApiKey: boolean
  onClosePanel:       () => void
  onRetry:            () => void
}

function AssistantFailure({ error, canConfigureApiKey, onClosePanel, onRetry }: AssistantFailureProps) {
  const t = useTranslations("help")

  // Always the code, never the message text: the 429 and 502 the route can return carry no
  // code and are indistinguishable on the client, so everything unrecognised is generic.
  const errorCode      = error instanceof ApiError ? error.code : undefined
  const isMissingKey   = errorCode === HELP_ERROR_CODES.aiKeyMissing
  const isRejectedKey  = errorCode === HELP_ERROR_CODES.aiKeyInvalid

  // Muted, not destructive: nothing went wrong with the request, the feature is not set up.
  if (isMissingKey || isRejectedKey) {
    return (
      <p className="mt-1.5 text-sm text-muted-foreground">
        {isMissingKey ? t("assistant.noApiKey") : t("assistant.apiKeyInvalid")}{" "}
        {canConfigureApiKey ? (
          <Link href={SETTINGS_HREF} className="text-foreground underline underline-offset-4" onClick={onClosePanel}>
            {isMissingKey ? t("assistant.noApiKeyConfigure") : t("assistant.apiKeyInvalidConfigure")}
          </Link>
        ) : (
          isMissingKey ? t("assistant.noApiKeyAskAdmin") : t("assistant.apiKeyInvalidAskAdmin")
        )}
      </p>
    )
  }

  return (
    <div className="mt-1.5 flex flex-col items-start gap-2">
      {/* The server's French sentence is shown verbatim when it has one. */}
      <p className="text-sm text-destructive">{error.message || t("assistant.error")}</p>
      <Button variant="ghost" size="sm" onClick={onRetry}>{t("retry")}</Button>
    </div>
  )
}
