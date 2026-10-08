"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { toast } from "sonner"
import { fr } from "date-fns/locale"
import { format } from "date-fns"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { TextareaField } from "@/components/ui/textarea-field"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  useErasureRequests, useHoldErasureRequest, useReleaseErasureRequest, useCancelErasureRequest,
  useApproveErasureRequest, erasureRequestStatusBadge, type ErasureRequest,
} from "@/hooks/use-erasure-requests"

export function ErasureRequestsSettings() {
  const t = useTranslations()
  const { data: requests = [], isLoading } = useErasureRequests()
  const [holdTarget, setHoldTarget]     = useState<ErasureRequest | null>(null)
  const [cancelTarget, setCancelTarget] = useState<ErasureRequest | null>(null)

  const releaseMutation = useReleaseErasureRequest()
  const approveMutation = useApproveErasureRequest()

  async function handleRelease(request: ErasureRequest) {
    try {
      await releaseMutation.mutateAsync(request.id)
      toast.success(t("parametres.erasureRequests.toasts.released"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.error"))
    }
  }

  async function handleApprove(request: ErasureRequest) {
    try {
      await approveMutation.mutateAsync(request.id)
      toast.success(t("parametres.erasureRequests.toasts.approved"))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.error"))
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{t("parametres.erasureRequests.title")}</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{t("parametres.erasureRequests.description")}</p>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2].map(index => <div key={index} className="h-10 rounded-lg bg-muted animate-pulse" />)}
        </div>
      ) : requests.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">{t("parametres.erasureRequests.empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent dark:hover:bg-transparent">
              <TableHead>{t("parametres.erasureRequests.columns.membre")}</TableHead>
              <TableHead>{t("parametres.erasureRequests.columns.status")}</TableHead>
              <TableHead>{t("parametres.erasureRequests.columns.requestedAt")}</TableHead>
              <TableHead className="w-56" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map(request => {
              const badge = erasureRequestStatusBadge(t, request.status)
              // REVIEW now has two distinct origins: the member themselves (POST /api/portal/
              // erasure-request) or the retention-sweep cron flagging 3+ years of inactivity
              // (requestedById null either way requires the same human approval below).
              const canApprove = request.status === "REVIEW"
              const canHold    = request.status === "PENDING" || request.status === "REVIEW"
              const canRelease = request.status === "HELD"
              const canCancel  = request.status !== "PROCESSED"
              return (
                <TableRow key={request.id}>
                  <TableCell>
                    <div className="font-medium">{request.membre.firstName} {request.membre.lastName}</div>
                    {request.membre.email && <div className="text-xs text-muted-foreground">{request.membre.email}</div>}
                    {!request.requestedById && (
                      <div className="text-xs text-muted-foreground">{t("parametres.erasureRequests.automaticOrigin")}</div>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    {/* Internal note typed into the hold modal — only other admins reviewing
                        the queue could otherwise see it, since it's never sent to the member. */}
                    {request.status === "HELD" && request.heldReason && (
                      <p className="text-xs text-muted-foreground mt-0.5">{request.heldReason}</p>
                    )}
                    {/* retryCount/lastError only ever change via the nightly cron failing on this
                        row — surfaced here so a stuck PENDING request doesn't look identical to
                        a freshly-created one that just hasn't had its first run yet. */}
                    {request.status === "PENDING" && request.retryCount > 0 && (
                      <p className="text-xs text-destructive mt-0.5" title={request.lastError ?? undefined}>
                        {t("parametres.erasureRequests.retryWarning", { count: request.retryCount })}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {format(new Date(request.requestedAt), "d MMMM yyyy", { locale: fr })}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      {canApprove && (
                        <Button variant="ghost" size="sm" onClick={() => handleApprove(request)} loading={approveMutation.isPending}>
                          {t("parametres.erasureRequests.actions.approve")}
                        </Button>
                      )}
                      {canHold && (
                        <Button variant="ghost" size="sm" onClick={() => setHoldTarget(request)}>
                          {t("parametres.erasureRequests.actions.hold")}
                        </Button>
                      )}
                      {canRelease && (
                        <Button variant="ghost" size="sm" onClick={() => handleRelease(request)} loading={releaseMutation.isPending}>
                          {t("parametres.erasureRequests.actions.release")}
                        </Button>
                      )}
                      {canCancel && (
                        <Button variant="ghost" size="sm" onClick={() => setCancelTarget(request)}>
                          {t("parametres.erasureRequests.actions.cancel")}
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}

      {holdTarget && (
        <HoldErasureRequestModal request={holdTarget} onClose={() => setHoldTarget(null)} />
      )}

      <CancelErasureRequestDialog request={cancelTarget} onClose={() => setCancelTarget(null)} />
    </div>
  )
}

function HoldErasureRequestModal({ request, onClose }: { request: ErasureRequest; onClose: () => void }) {
  const t = useTranslations()
  const holdMutation = useHoldErasureRequest()
  const [reason, setReason] = useState("")

  async function handleConfirm() {
    try {
      await holdMutation.mutateAsync({ id: request.id, reason: reason.trim() || undefined })
      toast.success(t("parametres.erasureRequests.toasts.held"))
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("common.error"))
    }
  }

  return (
    <Modal
      open
      onOpenChange={isOpen => { if (!isOpen) onClose() }}
      title={t("parametres.erasureRequests.holdModal.title")}
      description={t("parametres.erasureRequests.holdModal.description")}
      size="sm"
      dismissable={!holdMutation.isPending}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={holdMutation.isPending}>{t("common.cancel")}</Button>
          <Button onClick={handleConfirm} loading={holdMutation.isPending}>{t("parametres.erasureRequests.holdModal.confirm")}</Button>
        </>
      }
    >
      <TextareaField
        label={t("parametres.erasureRequests.holdModal.reasonLabel")}
        value={reason}
        onChange={e => setReason(e.target.value)}
        rows={3}
      />
    </Modal>
  )
}

function CancelErasureRequestDialog({ request, onClose }: { request: ErasureRequest | null; onClose: () => void }) {
  const t = useTranslations()
  const cancelMutation = useCancelErasureRequest()

  async function handleConfirm() {
    if (!request) return
    await cancelMutation.mutateAsync(request.id)
    toast.success(t("parametres.erasureRequests.toasts.cancelled"))
    onClose()
  }

  return (
    <ConfirmDialog
      open={!!request}
      onOpenChange={isOpen => { if (!isOpen) onClose() }}
      title={t("parametres.erasureRequests.cancelConfirmTitle")}
      description={t("parametres.erasureRequests.cancelConfirmDescription")}
      confirmLabel={t("parametres.erasureRequests.actions.cancel")}
      confirmVariant="default"
      loading={cancelMutation.isPending}
      onConfirm={handleConfirm}
    />
  )
}
