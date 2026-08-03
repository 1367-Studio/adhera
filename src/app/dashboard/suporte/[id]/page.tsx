"use client"

import { useEffect, useRef } from "react"
import { useParams } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import {
  useSupportTicket, useReplySupportTicket, usePatchSupportTicket,
} from "@/hooks/use-support-tickets"
import { useSupportTicketMessageListener } from "@/hooks/use-support-ticket-listener"
import { SupportTicketThread } from "@/components/support/support-ticket-thread"
import { BackLink } from "@/components/ui/back-link"
import { DetailNotFound } from "@/components/ui/detail-not-found"
import { DetailLoadingSkeleton } from "@/components/ui/detail-loading-skeleton"

export default function SupportTicketDetailPage() {
  const { id } = useParams<{ id: string }>()
  const t  = useTranslations("support")
  const qc = useQueryClient()

  const { data: ticket, isLoading, isError } = useSupportTicket(id)
  const replyMutation = useReplySupportTicket(id)
  const patchMutation = usePatchSupportTicket(id)
  // Separate mutation instance from `patchMutation` above — this one fires silently in the
  // background on every ticket open, so it must not share pending state with the Close
  // button (which would otherwise show a spurious loading spinner on page load).
  const markReadMutation = usePatchSupportTicket(id)

  useSupportTicketMessageListener((data) => {
    if (data.ticketId === id) qc.invalidateQueries({ queryKey: ["support-tickets", id] })
  })

  // Marks read once per ticket visit (not on every refetch/re-render) — opening the thread
  // is what "reading" it means here, independent of whether the list itself has been told yet.
  const markedReadRef = useRef<string | null>(null)
  useEffect(() => {
    if (!ticket || markedReadRef.current === ticket.id) return
    markedReadRef.current = ticket.id
    markReadMutation.mutate({ read: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticket?.id])

  if (isLoading) return <DetailLoadingSkeleton />
  if (isError || !ticket) {
    return <DetailNotFound message={t("notFound")} backHref="/dashboard/suporte" backLabel={t("backToList")} />
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

  return (
    <div className="space-y-4">
      <BackLink href="/dashboard/suporte">{t("backToList")}</BackLink>
      <SupportTicketThread
        subject={ticket.subject}
        status={ticket.status}
        messages={ticket.messages ?? []}
        viewerRole="ADMIN"
        onSend={handleSend}
        sending={replyMutation.isPending}
        onClose={handleClose}
        closing={patchMutation.isPending}
      />
    </div>
  )
}
