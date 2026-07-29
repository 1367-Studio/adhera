"use client"

import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { useTranslations } from "next-intl"
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"

export type ActivityLogEntry = {
  id:        string
  action:    string
  actorName: string | null
  createdAt: string
  metadata:  unknown
}

type Translator = ReturnType<typeof useTranslations>

// Shared between the per-document history modal (Devis/Facture) and the Fournisseur
// detail page's aggregated "Historique" tab — an action missing here just falls back to
// its raw code instead of a translated label, it never breaks the list.
function getActionLabels(t: Translator): Record<string, string> {
  return {
    DEVIS_CREATED:              t("documents.activityLog.devisCreated"),
    DEVIS_UPDATED:              t("documents.activityLog.devisUpdated"),
    DEVIS_SENT:                 t("documents.activityLog.devisSent"),
    DEVIS_ACCEPTED:             t("documents.activityLog.devisAccepted"),
    DEVIS_REFUSED:              t("documents.activityLog.devisRefused"),
    DEVIS_EXPIRED:              t("documents.activityLog.devisExpired"),
    DEVIS_DUPLICATED:           t("documents.activityLog.devisDuplicated"),
    DEVIS_CONVERTED:            t("documents.activityLog.devisConverted"),
    DEVIS_DELETED:              t("documents.activityLog.devisDeleted"),
    DEVIS_EMAIL_SENT:           t("documents.activityLog.devisEmailSent"),
    FACTURE_CREATED:            t("documents.activityLog.factureCreated"),
    FACTURE_CREATED_FROM_DEVIS: t("documents.activityLog.factureCreatedFromDevis"),
    FACTURE_UPDATED:            t("documents.activityLog.factureUpdated"),
    FACTURE_DUPLICATED:         t("documents.activityLog.factureDuplicated"),
    FACTURE_DELETED:            t("documents.activityLog.factureDeleted"),
    FACTURE_PAYMENT_ADDED:      t("documents.activityLog.facturePaymentAdded"),
    FACTURE_PAYMENT_REMOVED:    t("documents.activityLog.facturePaymentRemoved"),
    FACTURE_EMAIL_SENT:         t("documents.activityLog.factureEmailSent"),
    FOURNISSEUR_CREATED:        t("documents.activityLog.fournisseurCreated"),
    FOURNISSEUR_UPDATED:        t("documents.activityLog.fournisseurUpdated"),
    FOURNISSEUR_DELETED:        t("documents.activityLog.fournisseurDeleted"),
    FACTURE_RECUE_CREATED:      t("documents.activityLog.factureRecueCreated"),
    FACTURE_RECUE_UPDATED:      t("documents.activityLog.factureRecueUpdated"),
    FACTURE_RECUE_DELETED:      t("documents.activityLog.factureRecueDeleted"),
  }
}

interface ActivityLogListProps {
  logs:         ActivityLogEntry[]
  emptyLabel?:  string
  /** Total entries available server-side (may exceed `logs.length` while paginated). */
  total?:       number
  hasMore?:     boolean
  onLoadMore?:  () => void
  loadingMore?: boolean
}

export function ActivityLogList({ logs, emptyLabel, total, hasMore, onLoadMore, loadingMore }: ActivityLogListProps) {
  const t = useTranslations()
  const actionLabels = getActionLabels(t)

  if (logs.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel ?? t("documents.activityLog.noHistory")}</p>
  }

  return (
    <div className="space-y-2">
      {logs.map(log => {
        const changes = (log.metadata as { changes?: Record<string, { old: string | null; new: string | null }> } | null)?.changes
        const statusChange = changes?.status

        return (
          <div key={log.id} className="flex items-start gap-2.5 rounded-lg border bg-card px-3 py-2.5 text-sm">
            <ClockCounterClockwiseIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div className="flex-1 space-y-0.5">
              <p>{actionLabels[log.action] ?? log.action}</p>
              {statusChange && (
                <p className="text-xs text-muted-foreground">
                  {t("documents.activityLog.statusChange", { old: statusChange.old ?? "—", new: statusChange.new ?? "—" })}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {log.actorName ?? t("documents.activityLog.system")} · {format(new Date(log.createdAt), "dd/MM/yyyy HH:mm", { locale: fr })}
              </p>
            </div>
          </div>
        )
      })}

      {hasMore && (
        <div className="flex items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
          {total !== undefined && <span>{t("documents.activityLog.shownOfTotal", { shown: logs.length, total })}</span>}
          <Button size="sm" variant="outline" onClick={onLoadMore} disabled={loadingMore} className="ml-auto h-7 text-xs">
            {loadingMore ? t("documents.loading") : t("documents.activityLog.loadMore")}
          </Button>
        </div>
      )}
    </div>
  )
}
