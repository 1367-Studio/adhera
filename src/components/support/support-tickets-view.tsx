"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { useTranslations, useLocale } from "next-intl"
import { formatDistanceToNow } from "date-fns"
import { PlusIcon } from "@phosphor-icons/react/dist/ssr";
import { useSupportTickets, useCreateSupportTicket } from "@/hooks/use-support-tickets"
import { useSupportTicketMessageListener } from "@/hooks/use-support-ticket-listener"
import { useQueryClient } from "@tanstack/react-query"
import { PageHeader } from "@/components/ui/page-header"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { FormField } from "@/components/ui/form-field"
import { TextareaField } from "@/components/ui/textarea-field"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import type { Locale } from "@/i18n/locales"
import { SUPPORT_TICKET_SUBJECT_MAX_LENGTH, SUPPORT_TICKET_BODY_MAX_LENGTH } from "@/lib/support-tickets-limits"

export function SupportTicketsView() {
  const t      = useTranslations("support")
  const qc     = useQueryClient()
  const router = useRouter()
  const dateFnsLocale = getDateFnsLocale(useLocale() as Locale)
  const { data: tickets = [], isLoading } = useSupportTickets()
  const createMutation = useCreateSupportTicket()

  const [createOpen, setCreateOpen] = useState(false)
  const [subject, setSubject] = useState("")
  const [body, setBody]       = useState("")

  // Any ticket message anywhere for this association (own reply from another tab, or a
  // staff reply) means this list is stale — cheap to just refetch rather than try to patch
  // one row in place.
  useSupportTicketMessageListener(() => { qc.invalidateQueries({ queryKey: ["support-tickets"] }) })

  async function handleCreate() {
    if (!subject.trim() || !body.trim()) return
    try {
      const ticket = await createMutation.mutateAsync({ subject: subject.trim(), body: body.trim() })
      toast.success(t("toasts.created"))
      setCreateOpen(false)
      setSubject("")
      setBody("")
      router.push(`/dashboard/suporte/${ticket.id}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toasts.error"))
    }
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("title")}
        description={t("subtitle")}
        action={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <PlusIcon className="mr-1.5 size-4" />
            {t("newTicket")}
          </Button>
        }
      />

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map(i => <div key={i} className="h-16 animate-pulse rounded-xl border bg-card" />)}
        </div>
      ) : tickets.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="space-y-2">
          {tickets.map(ticket => (
            <Link key={ticket.id} href={`/dashboard/suporte/${ticket.id}`}>
              <Card className="flex-row items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {ticket.unread && <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden />}
                    <p className="truncate font-medium">{ticket.subject}</p>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(ticket.lastMessageAt), { addSuffix: true, locale: dateFnsLocale })}
                  </p>
                </div>
                <Badge variant={ticket.status === "OUVERT" ? "default" : "secondary"}>
                  {ticket.status === "OUVERT" ? t("status.open") : t("status.closed")}
                </Badge>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Modal open={createOpen} onOpenChange={setCreateOpen} title={t("newTicket")} size="lg" dismissable={!createMutation.isPending}>
        <div className="space-y-4">
          <FormField
            label={t("form.subject")}
            required
            value={subject}
            onChange={e => setSubject(e.target.value)}
            maxLength={SUPPORT_TICKET_SUBJECT_MAX_LENGTH}
            labelAction={`${subject.length}/${SUPPORT_TICKET_SUBJECT_MAX_LENGTH}`}
          />
          <TextareaField
            label={t("form.message")}
            required
            rows={5}
            value={body}
            onChange={e => setBody(e.target.value)}
            maxLength={SUPPORT_TICKET_BODY_MAX_LENGTH}
            labelAction={`${body.length}/${SUPPORT_TICKET_BODY_MAX_LENGTH}`}
          />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)} disabled={createMutation.isPending}>
              {t("form.cancel")}
            </Button>
            <Button type="button" onClick={handleCreate} loading={createMutation.isPending} disabled={!subject.trim() || !body.trim()}>
              {t("form.send")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
