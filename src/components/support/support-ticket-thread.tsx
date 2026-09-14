"use client"

import { useEffect, useRef, useState } from "react"
import { useTranslations, useLocale } from "next-intl"
import { formatDistanceToNow } from "date-fns"
import { toast } from "sonner"
import { PaperPlaneRightIcon, LockIcon, LockOpenIcon, SparkleIcon } from "@phosphor-icons/react/dist/ssr";
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import type { HelpSource, SupportReplySuggestion } from "@/hooks/use-help"
import { cn } from "@/lib/utils"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import type { Locale } from "@/i18n/locales"

export type ThreadMessage = {
  id:        string
  body:      string
  createdAt: string
  author:    { name: string | null; role: string }
}

interface SupportTicketThreadProps {
  subject:  string
  status:   "OUVERT" | "FERME"
  messages: ThreadMessage[]
  // Which "side" the person looking at this screen is on — an ADMIN viewing their own
  // association's ticket, or a SUPER_ADMIN viewing it from the backoffice. Drives which
  // messages align right ("you") vs left ("them"), same convention as any two-party chat.
  viewerRole: "ADMIN" | "SUPER_ADMIN"
  onSend:     (body: string) => Promise<void>
  sending?:   boolean
  onClose?:   () => void
  onReopen?:  () => void
  closing?:   boolean
  // Backoffice only: returns an AI-drafted reply for this ticket. The page owns the mutation
  // (and the ticket id); the thread only renders the button and manages the composer.
  onSuggestReply?: () => Promise<SupportReplySuggestion>
}

// Shared by the tenant (/dashboard/suporte/[id]) and backoffice (/backoffice/support/[id])
// detail pages — there's no existing chat-thread UI anywhere else in this codebase to model
// this on, so it's new, but built once here rather than duplicated per side.
export function SupportTicketThread({
  subject, status, messages, viewerRole, onSend, sending, onClose, onReopen, closing, onSuggestReply,
}: SupportTicketThreadProps) {
  const t = useTranslations("support")
  const locale = useLocale() as Locale
  const dateFnsLocale = getDateFnsLocale(locale)
  const [draft, setDraft] = useState("")
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)
  const [confirmSuggestOpen, setConfirmSuggestOpen] = useState(false)
  const [suggestionSources, setSuggestionSources] = useState<HelpSource[] | null>(null)
  const [suggestionPending, setSuggestionPending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)

  const canSuggestReply = viewerRole === "SUPER_ADMIN" && !!onSuggestReply

  async function handleConfirmClose() {
    try {
      await onClose?.()
      setConfirmCloseOpen(false)
    } catch {
      // onClose already surfaced its own error toast — dialog stays open so the user can retry
    }
  }

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages.length])

  // The AI call only runs once the staff member has confirmed (or had nothing to lose):
  // never spend a request on a suggestion that may be cancelled. The composer is locked
  // while it runs, so nothing typed in the meantime can be overwritten by the result.
  async function runSuggestion() {
    if (!onSuggestReply) return
    setSuggestionPending(true)
    try {
      const suggestion = await onSuggestReply()
      setDraft(suggestion.suggestion)
      setSuggestionSources(suggestion.sources)
      setConfirmSuggestOpen(false)
      composerRef.current?.focus()
    } finally {
      setSuggestionPending(false)
    }
  }

  function handleSuggest() {
    if (draft.trim()) {
      setConfirmSuggestOpen(true)
      return
    }
    runSuggestion().catch(error => {
      toast.error(error instanceof Error ? error.message : t("suggestReplyError"))
    })
  }

  function handleDraftChange(value: string) {
    setDraft(value)
    // The note describes the text in the composer — emptying it by hand retires the note.
    if (!value.trim()) setSuggestionSources(null)
  }

  async function handleSend() {
    const body = draft.trim()
    if (!body || sending) return
    try {
      await onSend(body)
      setDraft("")
      setSuggestionSources(null)
    } catch {
      // onSend already surfaced its own error (toast) — the draft is deliberately kept so a
      // failed send (network blip, etc.) doesn't also cost the user what they typed.
    }
  }

  return (
    <div className="flex h-[calc(100vh-220px)] min-h-[420px] flex-col rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{subject}</h2>
          <Badge variant={status === "OUVERT" ? "default" : "secondary"} className="mt-1">
            {status === "OUVERT" ? t("status.open") : t("status.closed")}
          </Badge>
        </div>
        {status === "OUVERT" && onClose && (
          <Button variant="outline" size="sm" onClick={() => setConfirmCloseOpen(true)} loading={closing}>
            <LockIcon className="mr-1.5 size-3.5" />
            {t("closeTicket")}
          </Button>
        )}
        {status === "FERME" && onReopen && (
          <Button variant="outline" size="sm" onClick={onReopen} loading={closing}>
            <LockOpenIcon className="mr-1.5 size-3.5" />
            {t("reopenTicket")}
          </Button>
        )}
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">{t("noMessages")}</p>
        )}
        {messages.map(m => {
          const fromViewerSide = m.author.role === viewerRole
          const label = m.author.name ?? (m.author.role === "SUPER_ADMIN" ? t("staffLabel") : "")
          return (
            <div key={m.id} className={cn("flex flex-col gap-1", fromViewerSide ? "items-end" : "items-start")}>
              <div className={cn(
                "max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words",
                fromViewerSide ? "bg-primary text-primary-foreground" : "bg-muted",
              )}>
                {m.body}
              </div>
              <span className="px-1 text-xs text-muted-foreground">
                {label ? `${label} · ` : ""}{formatDistanceToNow(new Date(m.createdAt), { addSuffix: true, locale: dateFnsLocale })}
              </span>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <div className="border-t">
        {suggestionSources !== null && (
          <p className="px-3 pt-2 text-xs text-muted-foreground">
            {t("suggestReplyNote")}
            {suggestionSources.length > 0 &&
              ` ${t("suggestReplySources", { titles: suggestionSources.map(source => source.title).join(", ") })}`}
          </p>
        )}
        <div className="flex items-end gap-2 p-3">
          <textarea
            ref={composerRef}
            className="min-h-11 max-h-40 flex-1 resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60"
            placeholder={t("composerPlaceholder")}
            value={draft}
            onChange={event => handleDraftChange(event.target.value)}
            onKeyDown={event => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                handleSend()
              }
            }}
            disabled={sending || suggestionPending}
          />
          {canSuggestReply && (
            <Button variant="ghost" className="shrink-0" onClick={handleSuggest} loading={suggestionPending} disabled={sending}>
              <SparkleIcon className="size-4" />
              {t("suggestReply")}
            </Button>
          )}
          <Button size="icon" onClick={handleSend} loading={sending} disabled={!draft.trim() || suggestionPending}>
            <PaperPlaneRightIcon className="size-4" />
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmCloseOpen}
        onOpenChange={setConfirmCloseOpen}
        title={t("closeConfirmTitle")}
        description={t("closeConfirmDescription")}
        confirmLabel={t("closeTicket")}
        loading={closing}
        onConfirm={handleConfirmClose}
      />

      <ConfirmDialog
        open={confirmSuggestOpen}
        onOpenChange={setConfirmSuggestOpen}
        title={t("suggestReplyConfirmTitle")}
        description={t("suggestReplyConfirmDescription")}
        confirmLabel={t("suggestReplyConfirmAction")}
        loading={suggestionPending}
        onConfirm={runSuggestion}
      />
    </div>
  )
}
