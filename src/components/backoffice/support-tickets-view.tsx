"use client"

import Link from "next/link"
import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useTranslations, useLocale } from "next-intl"
import { formatDistanceToNow } from "date-fns"
import { useBackofficeSupportTickets, type SupportTicketStatus } from "@/hooks/use-backoffice-support-tickets"
import { useSupportStaffTicketListener } from "@/hooks/use-support-ticket-listener"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { getDateFnsLocale } from "@/lib/date-fns-locale"
import type { Locale } from "@/i18n/locales"

const QK = ["backoffice", "support-tickets"]

export function BackofficeSupportTicketsView() {
  const t  = useTranslations("support")
  const qc = useQueryClient()
  const dateFnsLocale = getDateFnsLocale(useLocale() as Locale)
  const [statusFilter, setStatusFilter] = useState<SupportTicketStatus | "all">("all")

  const { data: tickets = [], isLoading } = useBackofficeSupportTickets(statusFilter === "all" ? undefined : statusFilter)

  useSupportStaffTicketListener(() => { qc.invalidateQueries({ queryKey: QK }) })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold tracking-tight">{t("backofficeTitle")}</h2>
        <Select value={statusFilter} onValueChange={v => setStatusFilter((v ?? "all") as SupportTicketStatus | "all")}>
          <SelectTrigger className="w-40">
            <SelectValue>
              {statusFilter === "all" ? t("filterAll") : statusFilter === "OUVERT" ? t("status.open") : t("status.closed")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filterAll")}</SelectItem>
            <SelectItem value="OUVERT">{t("status.open")}</SelectItem>
            <SelectItem value="FERME">{t("status.closed")}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map(i => <div key={i} className="h-16 animate-pulse rounded-xl border bg-card" />)}
        </div>
      ) : tickets.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="space-y-2">
          {tickets.map(ticket => (
            <Link key={ticket.id} href={`/backoffice/support/${ticket.id}`}>
              <Card className="flex-row items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-muted/40">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {ticket.unread && <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden />}
                    <p className="truncate font-medium">{ticket.subject}</p>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {ticket.association.name} · {formatDistanceToNow(new Date(ticket.lastMessageAt), { addSuffix: true, locale: dateFnsLocale })}
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
    </div>
  )
}
