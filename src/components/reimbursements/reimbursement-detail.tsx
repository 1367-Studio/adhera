"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { format } from "date-fns"
import { fr } from "date-fns/locale"
import {
  PlusIcon, PencilSimpleIcon, TrashIcon, PaperPlaneTiltIcon, XIcon,
  CheckIcon, ArrowCounterClockwiseIcon, ClockCounterClockwiseIcon, ArrowSquareOutIcon,
} from "@phosphor-icons/react/dist/ssr"
import {
  useReimbursementDetail, useAddReimbursementItem, useUpdateReimbursementItem, useDeleteReimbursementItem,
  useSubmitReimbursementRequest, useCancelReimbursementRequest, useApproveReimbursementRequest,
  useRequestReimbursementCorrection, useRejectReimbursementRequest, useRegisterReimbursement,
  useUpdateReimbursementRequest, useDeleteReimbursementRequest,
} from "@/hooks/use-reimbursements"
import { useFinanceCategories } from "@/hooks/use-finance-categories"
import type { ReimbursementItemInput, ReimbursementRegisterInput } from "@/lib/schemas"
import { BackLink } from "@/components/ui/back-link"
import { DetailLoadingSkeleton } from "@/components/ui/detail-loading-skeleton"
import { DetailNotFound } from "@/components/ui/detail-not-found"
import { PageHeader } from "@/components/ui/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { TextareaField } from "@/components/ui/textarea-field"
import { SelectField } from "@/components/ui/select-field"
import { DocumentHistoryModal } from "@/components/ui/document-history-modal"
import { ReimbursementItemForm } from "@/components/reimbursements/reimbursement-item-form"
import { ReimbursementForm } from "@/components/reimbursements/reimbursement-form"
import { ReimbursementRegisterModal } from "@/components/reimbursements/reimbursement-register-modal"
import { useCurrentUser, useHasAccess, useIsAdministrator } from "@/lib/user-context"

const fmt = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

type ReimbursementItem = {
  id: string; date: string; description: string; amount: string; categoryId: string
  receiptUrl: string; receiptFileName: string | null; isImmobilisation: boolean
  category: { id: string; name: string }
  expense: { id: string; status: string } | null
}

type ReimbursementDetailData = {
  id: string; subject: string; comment: string | null; status: string; totalAmount: string
  correctionComment: string | null; rejectionReason: string | null
  submittedAt: string | null; decidedAt: string | null; cancelledAt: string | null
  requester: { id: string; name: string | null }
  decidedBy: { id: string; name: string | null } | null
  cancelledBy: { id: string; name: string | null } | null
  project: { id: string; name: string } | null
  event: { id: string; title: string } | null
  items: ReimbursementItem[]
  reimbursement: { id: string; date: string; paymentMethod: string; reference: string | null; bankAccount: { accountName: string } | null; registeredBy: { name: string | null } } | null
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline" | "success" | "warning"> = {
  DRAFT: "outline", PENDING_APPROVAL: "secondary", NEEDS_CORRECTION: "warning",
  APPROVED: "secondary", REJECTED: "destructive", REIMBURSED: "success", CANCELLED: "outline",
}

// Small single-field confirm — Request-correction and Reject both need a mandatory note,
// which ConfirmDialog alone can't collect.
function DecisionNoteModal({
  open, onOpenChange, title, label, onConfirm, loading, required = true,
}: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; label: string
  onConfirm: (note: string) => void; loading?: boolean; required?: boolean
}) {
  const t = useTranslations()
  const [note, setNote] = useState("")
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} size="md">
      <div className="space-y-4">
        <TextareaField label={label} required={required} value={note} onChange={(e) => setNote(e.target.value)} rows={4} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>{t("common.cancel")}</Button>
          <Button onClick={() => onConfirm(note)} disabled={(required && !note.trim()) || loading} loading={loading}>{t("common.confirm")}</Button>
        </div>
      </div>
    </Modal>
  )
}

export function ReimbursementDetail({ id }: { id: string }) {
  const t = useTranslations()
  const router = useRouter()
  const currentUser = useCurrentUser()
  const canManage = useHasAccess("reimbursements", "edit")
  const isAdmin = useIsAdministrator()

  const { data, isLoading } = useReimbursementDetail(id)
  const request = data as ReimbursementDetailData | undefined

  const [itemModalOpen, setItemModalOpen]   = useState(false)
  const [editItemTarget, setEditItemTarget] = useState<ReimbursementItem | null>(null)
  const [deleteItemTarget, setDeleteItemTarget] = useState<ReimbursementItem | null>(null)
  const [editHeaderOpen, setEditHeaderOpen] = useState(false)
  const [cancelOpen, setCancelOpen]         = useState(false)
  const [correctionOpen, setCorrectionOpen] = useState(false)
  const [rejectOpen, setRejectOpen]         = useState(false)
  const [registerOpen, setRegisterOpen]     = useState(false)
  const [deleteOpen, setDeleteOpen]         = useState(false)
  const [historyOpen, setHistoryOpen]       = useState(false)
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, string>>({})

  const { data: categories = [] } = useFinanceCategories("EXPENSE")
  const categoryOptions = categories.map((c: { id: string; name: string }) => ({ value: c.id, label: c.name }))

  const addItemMutation    = useAddReimbursementItem(id)
  const updateItemMutation = useUpdateReimbursementItem(id)
  const deleteItemMutation = useDeleteReimbursementItem(id)
  const updateHeaderMutation = useUpdateReimbursementRequest(id)
  const submitMutation     = useSubmitReimbursementRequest()
  const cancelMutation      = useCancelReimbursementRequest()
  const approveMutation     = useApproveReimbursementRequest()
  const correctionMutation  = useRequestReimbursementCorrection()
  const rejectMutation      = useRejectReimbursementRequest()
  const registerMutation    = useRegisterReimbursement()
  const deleteMutation      = useDeleteReimbursementRequest()

  if (isLoading) return <DetailLoadingSkeleton />
  if (!request) {
    return <DetailNotFound message={t("reimbursements.detail.notFound")} backHref="/dashboard/reimbursements" backLabel={t("reimbursements.view.title")} />
  }

  const isOwner       = request.requester.id === currentUser.id
  const canEditHeader  = isOwner && (request.status === "DRAFT" || request.status === "NEEDS_CORRECTION")
  const canSubmit      = isOwner && (request.status === "DRAFT" || request.status === "NEEDS_CORRECTION") && request.items.length > 0
  // DRAFT isn't included here: a request never submitted has nothing to "withdraw" — the
  // only meaningful action on it is Delete (below). Offering both for the same DRAFT state
  // read as two buttons doing the same thing.
  const canOwnerCancel = isOwner && ["PENDING_APPROVAL", "NEEDS_CORRECTION"].includes(request.status)
  const canApprove     = canManage && request.status === "PENDING_APPROVAL" && (!isOwner || isAdmin)
  const canManagerCancel = canManage && request.status === "APPROVED"
  const canRegister    = canManage && request.status === "APPROVED"
  const canDelete       = isOwner && request.status === "DRAFT"
  // The viewer would normally see the Approve/Correction/Reject actions (they have
  // "reimbursements" edit access) but can't here, specifically because they're also the
  // requester and aren't an administrator — the one case where "nobody approves their own
  // request" can leave a request stuck with nobody else around to review it. Surfaced so it
  // doesn't look like the actions are just missing/broken.
  const isSelfApprovalBlocked = isOwner && canManage && !isAdmin && request.status === "PENDING_APPROVAL"

  async function handleAddItem(itemData: ReimbursementItemInput) {
    try {
      const result = await addItemMutation.mutateAsync(itemData)
      if (result.duplicateWarning) toast.warning(t("reimbursements.form.duplicateWarning"))
      toast.success(t("reimbursements.detail.toasts.itemAdded"))
      setItemModalOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleUpdateItem(itemData: ReimbursementItemInput) {
    if (!editItemTarget) return
    try {
      await updateItemMutation.mutateAsync({ itemId: editItemTarget.id, data: itemData })
      toast.success(t("reimbursements.detail.toasts.itemUpdated"))
      setEditItemTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleDeleteItem() {
    if (!deleteItemTarget) return
    try {
      await deleteItemMutation.mutateAsync(deleteItemTarget.id)
      toast.success(t("reimbursements.detail.toasts.itemDeleted"))
      setDeleteItemTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleSubmit() {
    try {
      await submitMutation.mutateAsync(id)
      toast.success(t("reimbursements.view.toasts.submitted"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleCancel(reason: string) {
    try {
      await cancelMutation.mutateAsync({ id, data: { reason } })
      toast.success(t("reimbursements.view.toasts.cancelled"))
      setCancelOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleDelete() {
    try {
      await deleteMutation.mutateAsync(id)
      toast.success(t("reimbursements.view.toasts.deleted"))
      router.push("/dashboard/reimbursements")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleApprove() {
    const categoryCorrections = Object.entries(categoryOverrides)
      .filter(([, categoryId]) => categoryId)
      .map(([itemId, categoryId]) => ({ itemId, categoryId }))
    try {
      await approveMutation.mutateAsync({ id, data: { categoryCorrections } })
      toast.success(t("reimbursements.view.toasts.approved"))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleRequestCorrection(note: string) {
    try {
      await correctionMutation.mutateAsync({ id, note })
      toast.success(t("reimbursements.view.toasts.correctionRequested"))
      setCorrectionOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleReject(note: string) {
    try {
      await rejectMutation.mutateAsync({ id, note })
      toast.success(t("reimbursements.view.toasts.rejected"))
      setRejectOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleRegister(registerData: ReimbursementRegisterInput) {
    try {
      await registerMutation.mutateAsync({ id, data: registerData })
      toast.success(t("reimbursements.view.toasts.reimbursed"))
      setRegisterOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  return (
    <div className="space-y-4">
      <BackLink href="/dashboard/reimbursements">{t("reimbursements.view.title")}</BackLink>

      <PageHeader
        title={request.subject}
        description={`${request.requester.name ?? ""}${request.event ? ` — ${request.event.title}` : ""}${request.project ? ` — ${request.project.name}` : ""}`}
        action={
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_VARIANT[request.status]}>{t(`reimbursements.view.status.${statusKey(request.status)}`)}</Badge>
            <Button variant="ghost" size="icon" onClick={() => setHistoryOpen(true)} title={t("reimbursements.detail.history")}>
              <ClockCounterClockwiseIcon className="size-4" />
            </Button>
          </div>
        }
      />

      {request.comment && <p className="text-sm text-muted-foreground">{request.comment}</p>}

      {request.status === "NEEDS_CORRECTION" && request.correctionComment && (
        <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          {t("reimbursements.detail.correctionFrom", { name: request.decidedBy?.name ?? "" })}: {request.correctionComment}
        </p>
      )}
      {request.status === "REJECTED" && request.rejectionReason && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          {t("reimbursements.detail.rejectedBy", { name: request.decidedBy?.name ?? "" })}: {request.rejectionReason}
        </p>
      )}
      {request.reimbursement && (
        <p className="text-sm text-muted-foreground">
          {t("reimbursements.detail.reimbursedOn", {
            date: format(new Date(request.reimbursement.date), "dd/MM/yyyy", { locale: fr }),
            method: t(`reimbursements.register.methods.${request.reimbursement.paymentMethod.toLowerCase()}`),
          })}
          {request.reimbursement.bankAccount && ` — ${request.reimbursement.bankAccount.accountName}`}
        </p>
      )}
      {isSelfApprovalBlocked && (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          {t("reimbursements.detail.selfApprovalBlockedNotice")}
        </p>
      )}

      <div className="rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/30 text-left text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">{t("reimbursements.form.itemDate")}</th>
              <th className="px-3 py-2 font-medium">{t("reimbursements.form.itemDescription")}</th>
              <th className="px-3 py-2 font-medium">{t("reimbursements.form.itemCategory")}</th>
              <th className="px-3 py-2 text-right font-medium">{t("reimbursements.form.itemAmount")}</th>
              <th className="px-3 py-2 font-medium">{t("reimbursements.form.itemReceipt")}</th>
              {(canEditHeader || canApprove) && <th className="w-16 px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {request.items.map(item => (
              <tr key={item.id} className="border-b last:border-0">
                <td className="px-3 py-2 whitespace-nowrap">{format(new Date(item.date), "dd/MM/yyyy", { locale: fr })}</td>
                <td className="px-3 py-2">
                  {item.description}
                  {item.isImmobilisation && (
                    <p className="text-xs text-muted-foreground">{t("reimbursements.detail.immobilisationTag")}</p>
                  )}
                </td>
                <td className="px-3 py-2">
                  {canApprove ? (
                    <SelectField
                      label=""
                      options={categoryOptions}
                      value={categoryOverrides[item.id] ?? item.categoryId}
                      onValueChange={(v) => setCategoryOverrides(prev => ({ ...prev, [item.id]: v }))}
                    />
                  ) : item.category.name}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{fmt(Number(item.amount))}</td>
                <td className="px-3 py-2">
                  <a href={item.receiptUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
                    <ArrowSquareOutIcon className="size-3.5" />
                    <span className="text-xs">{item.receiptFileName || t("reimbursements.detail.viewReceipt")}</span>
                  </a>
                </td>
                {(canEditHeader || canApprove) && (
                  <td className="px-3 py-2">
                    {canEditHeader && (
                      <div className="flex items-center gap-1">
                        <button type="button" onClick={() => setEditItemTarget(item)} title={t("common.edit")}>
                          <PencilSimpleIcon className="size-3.5 text-muted-foreground hover:text-foreground" />
                        </button>
                        <button type="button" onClick={() => setDeleteItemTarget(item)} title={t("common.delete")}>
                          <TrashIcon className="size-3.5 text-muted-foreground hover:text-destructive" />
                        </button>
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {request.items.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-sm text-muted-foreground">{t("reimbursements.form.noItems")}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        {canEditHeader && (
          <Button variant="outline" size="sm" onClick={() => setItemModalOpen(true)}>
            <PlusIcon className="mr-1.5 size-4" />
            {t("reimbursements.form.addItem")}
          </Button>
        )}
        <p className="ml-auto text-sm font-medium">{t("reimbursements.form.total")}: <span className="tabular-nums">{fmt(Number(request.totalAmount))}</span></p>
      </div>

      <div className="flex flex-wrap justify-end gap-2 pt-2">
        {canEditHeader && (
          <Button variant="outline" size="sm" onClick={() => setEditHeaderOpen(true)}>
            <PencilSimpleIcon className="mr-1.5 size-4" />{t("common.edit")}
          </Button>
        )}
        {canDelete && (
          <Button variant="outline" size="sm" onClick={() => setDeleteOpen(true)}>
            <TrashIcon className="mr-1.5 size-4" />{t("common.delete")}
          </Button>
        )}
        {(canOwnerCancel || canManagerCancel) && (
          <Button variant="outline" size="sm" onClick={() => setCancelOpen(true)}>
            <XIcon className="mr-1.5 size-4" />{t("reimbursements.view.actions.cancel")}
          </Button>
        )}
        {canSubmit && (
          <Button size="sm" onClick={handleSubmit} loading={submitMutation.isPending}>
            <PaperPlaneTiltIcon className="mr-1.5 size-4" />{t("reimbursements.view.actions.submit")}
          </Button>
        )}
        {canApprove && (
          <>
            <Button variant="outline" size="sm" onClick={() => setRejectOpen(true)}>
              {t("reimbursements.detail.rejectButton")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCorrectionOpen(true)}>
              <ArrowCounterClockwiseIcon className="mr-1.5 size-4" />{t("reimbursements.detail.requestCorrectionButton")}
            </Button>
            <Button size="sm" onClick={handleApprove} loading={approveMutation.isPending}>
              <CheckIcon className="mr-1.5 size-4" />{t("reimbursements.detail.approveButton")}
            </Button>
          </>
        )}
        {canRegister && (
          <Button size="sm" onClick={() => setRegisterOpen(true)}>
            {t("reimbursements.register.registerButton")}
          </Button>
        )}
      </div>

      <Modal open={itemModalOpen} onOpenChange={setItemModalOpen} title={t("reimbursements.form.addItem")} size="lg" dismissable={false}>
        <ReimbursementItemForm onSubmit={handleAddItem} onCancel={() => setItemModalOpen(false)} loading={addItemMutation.isPending} />
      </Modal>

      <Modal open={!!editItemTarget} onOpenChange={(open) => !open && setEditItemTarget(null)} title={t("common.edit")} size="lg" dismissable={false}>
        {editItemTarget && (
          <ReimbursementItemForm
            key={editItemTarget.id}
            defaultValues={{
              date: editItemTarget.date.split("T")[0],
              description: editItemTarget.description,
              amount: Number(editItemTarget.amount),
              categoryId: editItemTarget.categoryId,
              receiptUrl: editItemTarget.receiptUrl,
              receiptFileName: editItemTarget.receiptFileName ?? "",
              isImmobilisation: editItemTarget.isImmobilisation,
            }}
            onSubmit={handleUpdateItem}
            onCancel={() => setEditItemTarget(null)}
            loading={updateItemMutation.isPending}
          />
        )}
      </Modal>

      <Modal open={editHeaderOpen} onOpenChange={setEditHeaderOpen} title={t("common.edit")} size="lg" dismissable={false}>
        <ReimbursementForm
          defaultValues={{ subject: request.subject, comment: request.comment ?? "", projectId: request.project?.id ?? "", eventId: request.event?.id ?? "" }}
          onSubmit={async (formData) => {
            try {
              await updateHeaderMutation.mutateAsync(formData)
              toast.success(t("reimbursements.view.toasts.updated"))
              setEditHeaderOpen(false)
            } catch (err) {
              toast.error(err instanceof Error ? err.message : t("common.error"))
            }
          }}
          onCancel={() => setEditHeaderOpen(false)}
          loading={updateHeaderMutation.isPending}
        />
      </Modal>

      <ReimbursementRegisterModal open={registerOpen} onOpenChange={setRegisterOpen} onSubmit={handleRegister} loading={registerMutation.isPending} amount={Number(request.totalAmount)} />

      <DecisionNoteModal
        open={correctionOpen} onOpenChange={setCorrectionOpen}
        title={t("reimbursements.detail.requestCorrectionButton")}
        label={t("reimbursements.detail.correctionCommentLabel")}
        onConfirm={handleRequestCorrection}
        loading={correctionMutation.isPending}
      />
      <DecisionNoteModal
        open={rejectOpen} onOpenChange={setRejectOpen}
        title={t("reimbursements.detail.rejectButton")}
        label={t("reimbursements.detail.rejectionReasonLabel")}
        onConfirm={handleReject}
        loading={rejectMutation.isPending}
      />

      <DecisionNoteModal
        open={cancelOpen} onOpenChange={setCancelOpen}
        title={t("reimbursements.view.cancelConfirmTitle")}
        label={t("reimbursements.view.cancelReasonLabel")}
        onConfirm={handleCancel}
        loading={cancelMutation.isPending}
        // Required only when a manager cancels an already-approved request (accounting
        // reversal) — the owner withdrawing a draft/pending/needs-correction request needs
        // no justification, nothing was ever posted yet.
        required={canManagerCancel && request.status === "APPROVED"}
      />

      <ConfirmDialog
        open={!!deleteItemTarget}
        onOpenChange={(open) => !open && setDeleteItemTarget(null)}
        title={t("reimbursements.detail.deleteItemConfirmTitle")}
        confirmLabel={t("common.delete")}
        loading={deleteItemMutation.isPending}
        onConfirm={handleDeleteItem}
      />

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t("reimbursements.view.deleteConfirmTitle")}
        description={t("reimbursements.view.deleteConfirmDescription")}
        confirmLabel={t("common.delete")}
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />

      <DocumentHistoryModal entity="ReimbursementRequest" entityId={id} documentNumber={request.subject} open={historyOpen} onOpenChange={setHistoryOpen} />
    </div>
  )
}

function statusKey(status: string): string {
  return status.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}
