"use client"

import { useState } from "react"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { useTranslations } from "next-intl"
import { EnvelopeSimpleIcon, CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react/dist/ssr";
import { useAutomationLogs } from "@/hooks/use-automation-logs"
import { Button } from "@/components/ui/button"

export function HistoriqueView() {
  const t = useTranslations("messages.historique")
  const [page, setPage] = useState(1)
  const { data, isLoading } = useAutomationLogs(page)

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 1

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">{t("title")}</h2>
        <p className="text-sm text-muted-foreground">{t("subtitle")}</p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="h-14 rounded-lg bg-muted animate-pulse" />
          ))}
        </div>
      ) : !data || data.logs.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed py-12 text-center">
          <EnvelopeSimpleIcon className="size-8 text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium">{t("noSends")}</p>
            <p className="text-xs text-muted-foreground">{t("noSendsHint")}</p>
          </div>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {t("sendsCount", { count: data.total })}
          </p>
          <div className="rounded-lg border overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">{t("columns.date")}</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">{t("columns.rule")}</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">{t("columns.recipient")}</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">{t("columns.subject")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.logs.map(log => (
                  <tr key={log.id} className="hover:bg-muted/20 transition-colors">
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {format(new Date(log.sentAt), "d MMM yyyy 'à' HH'h'mm", { locale: fr })}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs font-medium">{log.rule.name}</span>
                    </td>
                    <td className="px-4 py-3">
                      {log.membre ? (
                        <div>
                          <p className="text-xs font-medium">{log.membre.firstName} {log.membre.lastName}</p>
                          {log.membre.email && (
                            <p className="text-xs text-muted-foreground">{log.membre.email}</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-xs truncate">
                      {log.subject ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{t("pageOf", { page, total: totalPages })}</span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                >
                  <CaretLeftIcon className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                >
                  <CaretRightIcon className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
