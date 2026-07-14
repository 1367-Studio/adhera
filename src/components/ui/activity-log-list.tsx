"use client"

import { format } from "date-fns"
import { fr } from "date-fns/locale"
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { Button } from "@/components/ui/button"

export type ActivityLogEntry = {
  id:        string
  action:    string
  actorName: string | null
  createdAt: string
  metadata:  unknown
}

// Shared between the per-document history modal (Devis/Facture) and the Fournisseur
// detail page's aggregated "Historique" tab — an action missing here just falls back to
// its raw code instead of a French label, it never breaks the list.
export const ACTION_LABELS: Record<string, string> = {
  DEVIS_CREATED:              "Devis créé",
  DEVIS_UPDATED:              "Devis modifié",
  DEVIS_SENT:                 "Devis envoyé",
  DEVIS_ACCEPTED:             "Devis accepté",
  DEVIS_REFUSED:              "Devis refusé",
  DEVIS_EXPIRED:              "Devis expiré",
  DEVIS_DUPLICATED:           "Devis dupliqué",
  DEVIS_CONVERTED:            "Devis converti en facture",
  DEVIS_DELETED:              "Devis supprimé",
  DEVIS_EMAIL_SENT:           "Devis envoyé par e-mail",
  FACTURE_CREATED:            "Facture créée",
  FACTURE_CREATED_FROM_DEVIS: "Facture créée depuis un devis",
  FACTURE_UPDATED:            "Facture modifiée",
  FACTURE_DUPLICATED:         "Facture dupliquée",
  FACTURE_DELETED:            "Facture supprimée",
  FACTURE_PAYMENT_ADDED:      "Paiement enregistré",
  FACTURE_PAYMENT_REMOVED:    "Paiement supprimé",
  FACTURE_EMAIL_SENT:         "Facture envoyée par e-mail",
  FOURNISSEUR_CREATED:        "Fournisseur créé",
  FOURNISSEUR_UPDATED:        "Fournisseur modifié",
  FOURNISSEUR_DELETED:        "Fournisseur archivé",
  FACTURE_RECUE_CREATED:      "Document ajouté",
  FACTURE_RECUE_UPDATED:      "Document modifié",
  FACTURE_RECUE_DELETED:      "Document supprimé",
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

export function ActivityLogList({ logs, emptyLabel = "Aucun historique", total, hasMore, onLoadMore, loadingMore }: ActivityLogListProps) {
  if (logs.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>
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
              <p>{ACTION_LABELS[log.action] ?? log.action}</p>
              {statusChange && (
                <p className="text-xs text-muted-foreground">
                  Statut : {statusChange.old ?? "—"} → {statusChange.new ?? "—"}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                {log.actorName ?? "Système"} · {format(new Date(log.createdAt), "dd/MM/yyyy HH:mm", { locale: fr })}
              </p>
            </div>
          </div>
        )
      })}

      {hasMore && (
        <div className="flex items-center justify-between gap-2 pt-1 text-xs text-muted-foreground">
          {total !== undefined && <span>{logs.length} sur {total}</span>}
          <Button size="sm" variant="outline" onClick={onLoadMore} disabled={loadingMore} className="ml-auto h-7 text-xs">
            {loadingMore ? "Chargement…" : "Voir plus"}
          </Button>
        </div>
      )}
    </div>
  )
}
