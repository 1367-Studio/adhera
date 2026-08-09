"use client"

import { useState, useEffect } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { EnvelopeSimpleIcon, DeviceMobileIcon, PaperPlaneTiltIcon, XIcon, WarningIcon, CaretRightIcon, PencilSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { FormField } from "@/components/ui/form-field"
import { RichTextEditor } from "@/components/ui/rich-text-editor"
import { useModules } from "@/lib/user-context"
import { registerPendingBulkSend } from "@/hooks/use-bulk-send-listener"
import { cn } from "@/lib/utils"

type ReminderCotisation = { id: string; year: number; amount: string; membre: { id: string; firstName: string; lastName: string } }

type Channel = "EMAIL" | "SMS"

interface SendReminderModalProps {
  open:         boolean
  onOpenChange: (open: boolean) => void
  cotisations:  ReminderCotisation[]
  onSent:       () => void
}

function fmtAmount(amount: string) {
  return parseFloat(amount).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })
}

function SmsCounter({ text }: { text: string }) {
  const t = useTranslations()
  const len = text.length
  const segments  = len === 0 ? 1 : len <= 160 ? 1 : Math.ceil(len / 153)
  const remaining = len <= 160 ? 160 - len : 153 - (len % 153 || 153)
  return (
    <p className={cn("text-xs text-right mt-1", remaining < 20 ? "text-amber-500" : "text-muted-foreground")}>
      {t("membres.sms.charsRemaining", { count: remaining })}
      {segments > 1 && <span className="ml-2 text-amber-500">{t("membres.sms.segmentsCount", { count: segments })}</span>}
    </p>
  )
}

export function SendReminderModal({ open, onOpenChange, cotisations, onSent }: SendReminderModalProps) {
  const t = useTranslations()
  const { sms: smsEnabled } = useModules()

  const [step,         setStep]         = useState<"compose" | "confirm">("compose")
  const [channel,      setChannel]      = useState<Channel>("EMAIL")
  const [removedIds,   setRemovedIds]   = useState<Set<string>>(new Set())
  const [subject,      setSubject]      = useState("")
  const [emailBody,    setEmailBody]    = useState("")
  const [smsBody,      setSmsBody]      = useState("")
  const [loadingTemplate, setLoadingTemplate] = useState(false)
  const [sending,      setSending]      = useState(false)

  const recipients = cotisations.filter(c => !removedIds.has(c.id))

  useEffect(() => {
    if (!open) return
    setStep("compose")
    setChannel("EMAIL")
    setRemovedIds(new Set())
    setLoadingTemplate(true)
    fetch("/api/message-templates/cotisation-default")
      .then(res => {
        if (!res.ok) throw new Error()
        return res.json()
      })
      .then(tpl => {
        setSubject(tpl.subject ?? "")
        setEmailBody(tpl.body ?? "")
        setSmsBody(tpl.smsBody ?? "")
      })
      .catch(() => toast.error(t("cotisations.reminderModal.toasts.templateLoadError")))
      .finally(() => setLoadingTemplate(false))
  }, [open, t])

  function removeRecipient(id: string) {
    setRemovedIds(prev => new Set(prev).add(id))
  }

  function handleContinue() {
    if (recipients.length === 0) return
    if (channel === "EMAIL" && !subject.trim()) {
      toast.error(t("cotisations.reminderModal.toasts.subjectRequired"))
      return
    }
    const body = channel === "EMAIL" ? emailBody : smsBody
    if (!body.trim() || (channel === "EMAIL" && body.replace(/<[^>]*>/g, "").trim().length === 0)) {
      toast.error(t("cotisations.reminderModal.toasts.bodyRequired"))
      return
    }
    setStep("confirm")
  }

  async function handleSend() {
    const body = channel === "EMAIL" ? emailBody : smsBody
    setSending(true)
    try {
      const res = await fetch("/api/cotisations/reminders", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          cotisationIds: recipients.map(c => c.id),
          channel,
          subject: channel === "EMAIL" ? subject : undefined,
          body,
        }),
      })
      const data = await res.json()
      if (!res.ok) { toast.error(data.error ?? t("common.error")); return }

      // The actual send now runs in the background (Inngest) — this response just confirms
      // it was queued. registerPendingBulkSend + useBulkSendListener (mounted in AppSidebar)
      // deliver the real sent/failed toast once the send finishes, even if this modal has
      // long since closed.
      registerPendingBulkSend(data.jobId)
      toast.info(t("cotisations.reminderModal.toasts.queued", { count: data.totalRecipients }))
      onSent()
    } catch {
      toast.error(t("common.networkError"))
    } finally {
      setSending(false)
    }
  }

  function handleClose() {
    if (sending) return
    onOpenChange(false)
  }

  return (
    <Modal
      open={open}
      onOpenChange={handleClose}
      title={t("cotisations.reminderModal.title")}
      size="lg"
      dismissable={!sending}
    >
      {step === "confirm" ? (
        <div className="space-y-5">
          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-4 flex gap-3">
            <WarningIcon className="size-5 shrink-0 text-amber-600 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-300">{t("cotisations.reminderModal.confirmTitle")}</p>
              <p className="text-sm text-amber-700 dark:text-amber-400">
                {t("cotisations.reminderModal.confirmDescription", {
                  channel: channel === "EMAIL" ? t("cotisations.reminderModal.channelEmail") : t("cotisations.reminderModal.channelSms"),
                  count:   recipients.length,
                })}
              </p>
            </div>
          </div>

          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            {channel === "EMAIL" && (
              <div className="space-y-0.5">
                <p className="text-xs text-muted-foreground">{t("cotisations.reminderModal.subjectLabel")}</p>
                <p className="text-sm font-medium">{subject}</p>
              </div>
            )}
            <div className="space-y-0.5">
              <p className="text-xs text-muted-foreground">{t("cotisations.reminderModal.recipients", { count: recipients.length })}</p>
              <p className="text-sm font-medium">
                {recipients.slice(0, 5).map(c => `${c.membre.firstName} ${c.membre.lastName}`).join(", ")}
                {recipients.length > 5 && t("cotisations.reminderModal.andOthers", { count: recipients.length - 5 })}
              </p>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setStep("compose")} disabled={sending}>
              <PencilSimpleIcon className="mr-1.5 size-3.5" />
              {t("common.edit")}
            </Button>
            <Button onClick={handleSend} loading={sending}>
              <PaperPlaneTiltIcon className="mr-1.5 size-4" />
              {t("cotisations.reminderModal.sendNow", { count: recipients.length })}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Channel */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setChannel("EMAIL")}
              className={cn(
                "flex items-center justify-center gap-2 rounded-md border p-3 text-sm font-medium transition-colors",
                channel === "EMAIL"
                  ? "border-primary bg-primary/5 text-primary ring-1 ring-primary"
                  : "border-border text-muted-foreground hover:border-muted-foreground/40 hover:bg-muted/40",
              )}
            >
              <EnvelopeSimpleIcon className="size-4" />
              {t("cotisations.reminderModal.channelEmail")}
            </button>
            <button
              type="button"
              disabled={!smsEnabled}
              onClick={() => setChannel("SMS")}
              title={!smsEnabled ? t("cotisations.reminderModal.smsModuleRequired") : undefined}
              className={cn(
                "flex items-center justify-center gap-2 rounded-md border p-3 text-sm font-medium transition-colors",
                !smsEnabled && "opacity-40 cursor-not-allowed",
                channel === "SMS"
                  ? "border-primary bg-primary/5 text-primary ring-1 ring-primary"
                  : "border-border text-muted-foreground hover:border-muted-foreground/40 hover:bg-muted/40",
              )}
            >
              <DeviceMobileIcon className="size-4" />
              {t("cotisations.reminderModal.channelSms")}
            </button>
          </div>

          {/* Recipients */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("cotisations.reminderModal.recipients", { count: recipients.length })}
            </p>
            <div className="max-h-40 overflow-y-auto rounded-lg border divide-y">
              {recipients.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-6">{t("cotisations.reminderModal.noRecipient")}</p>
              ) : (
                recipients.map(c => (
                  <div key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{c.membre.lastName} {c.membre.firstName}</span>
                      <span className="text-muted-foreground"> — {c.year} · {fmtAmount(c.amount)}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => removeRecipient(c.id)}
                      className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                      aria-label={t("cotisations.reminderModal.removeRecipient")}
                    >
                      <XIcon className="size-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="border-t" />

          {/* Message */}
          {loadingTemplate ? (
            <div className="h-40 rounded-lg bg-muted animate-pulse" />
          ) : channel === "EMAIL" ? (
            <div className="space-y-3">
              <FormField
                label={t("cotisations.reminderModal.subjectLabel")}
                required
                value={subject}
                onChange={e => setSubject(e.target.value)}
              />
              <RichTextEditor
                label={t("cotisations.reminderModal.bodyLabel")}
                required
                value={emailBody}
                onChange={setEmailBody}
                minHeight="160px"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("cotisations.reminderModal.bodyLabel")}</p>
              <textarea
                rows={5}
                maxLength={1600}
                value={smsBody}
                onChange={e => setSmsBody(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring resize-none"
              />
              <SmsCounter text={smsBody} />
            </div>
          )}

          <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/20 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
            <WarningIcon className="size-3.5 shrink-0 mt-0.5" />
            <span>{t("cotisations.reminderModal.variablesNotice")}</span>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={handleClose}>{t("common.cancel")}</Button>
            <Button onClick={handleContinue} disabled={recipients.length === 0 || loadingTemplate}>
              <CaretRightIcon className="mr-1.5 size-4" />
              {t("cotisations.reminderModal.continue")}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  )
}
