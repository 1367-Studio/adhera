"use client"

import { useState } from "react"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { MailIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { useAutomationLogs } from "@/hooks/use-automation-logs"
import { Button } from "@/components/ui/button"

export function HistoriqueView() {
  const [page, setPage] = useState(1)
  const { data, isLoading } = useAutomationLogs(page)

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 1

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">Historique des envois</h2>
        <p className="text-sm text-muted-foreground">Tous les emails envoyés automatiquement par les règles actives.</p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="h-14 rounded-xl bg-muted animate-pulse" />
          ))}
        </div>
      ) : !data || data.logs.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-12 text-center">
          <MailIcon className="size-8 text-muted-foreground/40" />
          <div>
            <p className="text-sm font-medium">Aucun envoi enregistré</p>
            <p className="text-xs text-muted-foreground">Les envois apparaîtront ici dès qu'une règle sera exécutée.</p>
          </div>
        </div>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {data.total} envoi{data.total > 1 ? "s" : ""} enregistré{data.total > 1 ? "s" : ""}
          </p>
          <div className="rounded-xl border overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">Date</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">Règle</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">Destinataire</th>
                  <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs">Sujet</th>
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
                            <p className="text-[11px] text-muted-foreground">{log.membre.email}</p>
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
              <span>Page {page} / {totalPages}</span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage(p => p - 1)}
                >
                  <ChevronLeftIcon className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={page >= totalPages}
                  onClick={() => setPage(p => p + 1)}
                >
                  <ChevronRightIcon className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
