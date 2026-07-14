"use client"

import { useInfiniteQuery } from "@tanstack/react-query"
import { Modal } from "@/components/ui/modal"
import { ActivityLogList, type ActivityLogEntry } from "@/components/ui/activity-log-list"

interface Props {
  entity:         "Devis" | "Facture"
  entityId:       string
  documentNumber?: string
  open:           boolean
  onOpenChange:   (open: boolean) => void
}

type LogsPage = { data: ActivityLogEntry[]; total: number; page: number; totalPages: number }

export function DocumentHistoryModal({ entity, entityId, documentNumber, open, onOpenChange }: Props) {
  // Paginated via useInfiniteQuery (same pattern as membre-activity-log.tsx) since the
  // backend caps each page at 50 entries — a heavily-edited document used to silently lose
  // everything past the first 50 with no "load more" affordance.
  const {
    data, isLoading, fetchNextPage, hasNextPage, isFetchingNextPage,
  } = useInfiniteQuery<LogsPage>({
    queryKey:        ["activity-logs", entity, entityId],
    initialPageParam: 1,
    queryFn:  ({ pageParam }) => fetch(`/api/activity-logs?entity=${entity}&entityId=${entityId}&page=${pageParam}`).then(r => r.json()),
    getNextPageParam: (last) => last.page < last.totalPages ? last.page + 1 : undefined,
    enabled:  open && !!entityId,
  })

  const logs  = data?.pages.flatMap(p => p.data) ?? []
  const total = data?.pages[0]?.total ?? 0

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Historique${documentNumber ? ` — ${documentNumber}` : ""}`} size="md">
      {isLoading ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Chargement…</p>
      ) : (
        <ActivityLogList
          logs={logs}
          total={total}
          hasMore={!!hasNextPage}
          onLoadMore={() => fetchNextPage()}
          loadingMore={isFetchingNextPage}
        />
      )}
    </Modal>
  )
}
