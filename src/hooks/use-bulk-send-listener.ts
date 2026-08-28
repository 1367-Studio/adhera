import { useEffect, useRef } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { getPusherClient } from "@/lib/pusher-client"
import { useCurrentUser } from "@/lib/user-context"

// Bulk sends (membres email/sms, cotisation reminders, sondage invitations) now run in
// Inngest, off the request/response cycle — the route that kicks one off returns a jobId
// almost instantly, and the real sent/failed counts only exist once the Inngest function
// finishes, seconds to minutes later. Rather than keep the sending modal open and blocked
// on that, the modal closes right away and this jobId is registered here; when the
// completion event arrives on the association's Pusher channel, we show the exact same
// toast the modal used to show synchronously — just later, and only to the browser tab
// that actually triggered the send (every admin on the association shares that channel,
// so without this filter everyone would see everyone else's send results).
const pendingJobIds = new Set<string>()

export function registerPendingBulkSend(jobId: string | null | undefined) {
  if (jobId) pendingJobIds.add(jobId)
}

type BulkSendCompletedPayload = {
  jobId: string
  kind:  "membres-email" | "membres-sms" | "cotisation-reminders" | "sondage-invitations" | "membres-import"
  sent?: number
  failed?: number
  failedNames?: string[]
  emailsSent?: number
  emailsFailed?: number
  membersCreated?: number
  membersMatched?: number
  cotisationsCreated?: number
  invitesSent?: number
  errors?: number
  importFailed?: boolean
}

export function useBulkSendListener() {
  const t = useTranslations()
  const { associationId } = useCurrentUser()
  const tRef = useRef(t)
  useEffect(() => { tRef.current = t })

  useEffect(() => {
    if (!associationId) return
    const pusher = getPusherClient()
    if (!pusher) return

    const channelName = `private-association-${associationId}`
    const channel = pusher.subscribe(channelName)

    function handler(data: BulkSendCompletedPayload) {
      if (!pendingJobIds.has(data.jobId)) return
      pendingJobIds.delete(data.jobId)
      const t = tRef.current

      if (data.kind === "membres-email") {
        const sent = data.sent ?? 0
        const failed = data.failed ?? 0
        if (sent === 0) {
          toast.error(failed > 0
            ? t("membres.email.toasts.noEmailSentWithFailures", { count: failed })
            : t("membres.email.toasts.noEmailSent"))
        } else {
          toast.success(t("membres.email.toasts.emailSent", { count: sent }))
          if (failed > 0) {
            const names = data.failedNames ?? []
            const preview = names.join(", ") + (failed > names.length ? t("membres.email.toasts.andOthers", { count: failed - names.length }) : "")
            toast.warning(t("membres.email.toasts.sendFailures", { count: failed, preview: preview ? ` : ${preview}` : "" }))
          }
        }
      }

      if (data.kind === "membres-sms") {
        const sent = data.sent ?? 0
        const failed = data.failed ?? 0
        const names = data.failedNames ?? []
        const preview = names.join(", ") + (failed > names.length ? t("membres.sms.toasts.andOthers", { count: failed - names.length }) : "")
        if (sent === 0) {
          toast.error(failed > 0
            ? t("membres.sms.toasts.noSmsSentWithFailures", { count: failed }) + (preview ? ` : ${preview}` : "")
            : t("membres.sms.toasts.noSmsSent"))
        } else {
          toast.success(t("membres.sms.toasts.smsSent", { count: sent }))
          if (failed > 0) {
            toast.warning(t("membres.sms.toasts.sendFailures", { count: failed, preview: preview ? ` : ${preview}` : "" }))
          }
        }
      }

      if (data.kind === "cotisation-reminders") {
        const sent = data.sent ?? 0
        const failed = data.failed ?? 0
        if (sent === 0) {
          toast.error(failed > 0
            ? t("cotisations.reminderModal.toasts.noReminderSentWithFailures", { count: failed })
            : t("cotisations.reminderModal.toasts.noReminderSent"))
        } else {
          toast.success(t("cotisations.reminderModal.toasts.reminderSent", { count: sent }))
          if (failed > 0) {
            toast.warning(t("cotisations.reminderModal.toasts.sendFailures", { count: failed }))
          }
        }
      }

      if (data.kind === "sondage-invitations") {
        const sent = data.emailsSent ?? 0
        const failed = data.emailsFailed ?? 0
        if (sent > 0) toast.info(t("sondages.detail.toasts.invitationsSent", { count: sent }))
        if (failed > 0) toast.warning(t("sondages.detail.toasts.invitationsFailed", { count: failed }))
      }

      if (data.kind === "membres-import") {
        if (data.importFailed) {
          toast.error(t("membres.importWizard.toasts.failed"))
        } else {
          const created = data.membersCreated ?? 0
          const matched = data.membersMatched ?? 0
          const errors  = data.errors ?? 0
          const invites = data.invitesSent ?? 0
          toast.success(t("membres.importWizard.toasts.completed", { created, matched }))
          if (invites > 0) toast.info(t("membres.importWizard.toasts.invitesSent", { count: invites }))
          if (errors > 0) toast.warning(t("membres.importWizard.toasts.completedWithErrors", { count: errors }))
        }
      }
    }

    channel.bind("bulk-send-completed", handler)
    return () => {
      channel.unbind("bulk-send-completed", handler)
      pusher.unsubscribe(channelName)
    }
  }, [associationId])
}
