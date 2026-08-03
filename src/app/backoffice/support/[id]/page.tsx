"use client"

import { useEffect, useRef } from "react"
import { useParams } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import {
  useBackofficeSupportTicket, useReplyBackofficeSupportTicket, usePatchBackofficeSupportTicket,
} from "@/hooks/use-backoffice-support-tickets"
import { useSupportStaffTicketListener } from "@/hooks/use-support-ticket-listener"
import { SupportTicketThread } from "@/components/support/support-ticket-thread"
import { BackLink } from "@/components/ui/back-link"
import { DetailNotFound } from "@/components/ui/detail-not-found"
import { DetailLoadingSkeleton } from "@/components/ui/detail-loading-skeleton"

export default function BackofficeSupportTicketDetailPage() {
  const { id } = useParams<{ id: string }>()
  const t  = useTranslations("support")
  const qc = useQueryClient()

  const { data: ticket, isLoading, isError } = useBackofficeSupportTicket(id)
  const replyMutation = useReplyBackofficeSupportTicket(id)
  const patchMutation = usePatchBackofficeSupportTicket(id)
  // Separate mutation instance from `patchMutation` above — this one fires silently in the
  // background on every ticket open, so it must not share pending state with the Close/Reopen
  // button (which was showing a spurious loading spinner on page load because of that overlap).
  const markReadMutation = usePatchBackofficeSupportTicket(id)

  useSupportStaffTicketListener((data) => {
    if (data.ticketId === id) qc.invalidateQueries({ queryKey: ["backoffice", "support-tickets", id] })
  })

  const markedReadRef = useRef<string | null>(null)
  useEffect(() => {
    if (!ticket || markedReadRef.current === ticket.id) return
    markedReadRef.current = ticket.id
    markReadMutation.mutate({ read: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.id])

  if (isLoading) return <DetailLoadingSkeleton />
  if (isError || !ticket) {
    return <DetailNotFound message={t("notFound")} backHref="/backoffice/support" backLabel={t("backToList")} />
  }

  async function handleSend(body: string) {
    try {
      await replyMutation.mutateAsync(body)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toasts.error"))
      throw err // re-thrown so SupportTicketThread knows the send failed and keeps the draft
    }
  }

  async function handleClose() {
    try {
      await patchMutation.mutateAsync({ status: "FERME" })
      toast.success(t("toasts.closed"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toasts.error"))
      throw err // re-thrown so SupportTicketThread's confirm dialog stays open on failure
    }
  }

  async function handleReopen() {
    try {
      await patchMutation.mutateAsync({ status: "OUVERT" })
      toast.success(t("toasts.reopened"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toasts.error"))
    }
  }

  return (
    <div className="space-y-4">
      <BackLink href="/backoffice/support">{t("backToList")}</BackLink>
      <p className="text-sm text-muted-foreground">{ticket.association.name}</p>
      <SupportTicketThread
        subject={ticket.subject}
        status={ticket.status}
        messages={ticket.messages ?? []}
        viewerRole="SUPER_ADMIN"
        onSend={handleSend}
        sending={replyMutation.isPending}
        onClose={handleClose}
        onReopen={handleReopen}
        closing={patchMutation.isPending}
      />
    </div>
  )
}
