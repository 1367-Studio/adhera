"use client"

import { useState } from "react"
import { toast } from "sonner"
import { useTranslations } from "next-intl"
import { PlusIcon, PencilSimpleIcon, TrashIcon, ArrowsLeftRightIcon } from "@phosphor-icons/react/dist/ssr";
import { useBankAccounts, useCreateBankAccount, useUpdateBankAccount, useDeleteBankAccount } from "@/hooks/use-bank-accounts"
import { useAccountTransfers, useCreateAccountTransfer, useUpdateAccountTransfer, useDeleteAccountTransfer } from "@/hooks/use-account-transfers"
import type { BankAccountInput, AccountTransferInput } from "@/lib/schemas"
import { PageHeader } from "@/components/ui/page-header"
import { DataTable, type Column } from "@/components/ui/data-table"
import { Modal } from "@/components/ui/modal"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { RowActions } from "@/components/ui/row-actions"
import { BankAccountForm } from "@/components/finances/bank-account-form"
import { AccountTransferForm } from "@/components/finances/account-transfer-form"
import { useHasAccess } from "@/lib/user-context"

type Account = {
  id:             string
  bankName:       string
  accountName:    string
  ibanLast4:      string | null
  currency:       string
  openingBalance: string
  currentBalance: string
  isActive:       boolean
}

type Transfer = {
  id:            string
  fromAccountId: string
  toAccountId:   string
  amount:        string
  date:          string
  note:          string | null
  fromAccount:   { accountName: string; bankName: string }
  toAccount:     { accountName: string; bankName: string }
}

export function BankAccountsView() {
  const t = useTranslations()
  // FORM-34: a Comptabilité reader browses and filters but cannot add, edit or delete.
  const canEditComptabilite = useHasAccess("comptabilite", "edit")
  const [createOpen, setCreateOpen]     = useState(false)
  const [editTarget, setEditTarget]     = useState<Account | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null)
  const [transferOpen, setTransferOpen]               = useState(false)
  const [editTransferTarget, setEditTransferTarget]   = useState<Transfer | null>(null)
  const [deleteTransferTarget, setDeleteTransferTarget] = useState<Transfer | null>(null)

  const { data: accounts = [], isLoading } = useBankAccounts()
  const { data: transfers = [], isLoading: transfersLoading } = useAccountTransfers()

  const createMutation = useCreateBankAccount()
  const updateMutation = useUpdateBankAccount(editTarget?.id ?? "")
  const deleteMutation = useDeleteBankAccount()
  const transferMutation = useCreateAccountTransfer()
  const updateTransferMutation = useUpdateAccountTransfer(editTransferTarget?.id ?? "")
  const deleteTransferMutation = useDeleteAccountTransfer()

  // New transfers only ever involve active accounts (moving money into/out of a closed
  // account makes no sense) — but editing one already pointed at a since-deactivated account
  // must still show that account in its dropdown instead of rendering the field blank, same
  // reasoning as income-form.tsx keeping archived projects selectable when editing.
  const activeAccounts = (accounts as Account[]).filter(a => a.isActive)
  const editTransferAccounts = editTransferTarget
    ? [
        ...activeAccounts,
        ...(accounts as Account[]).filter(a =>
          (a.id === editTransferTarget.fromAccountId || a.id === editTransferTarget.toAccountId) && !a.isActive,
        ),
      ]
    : activeAccounts

  async function handleCreate(data: BankAccountInput) {
    try {
      await createMutation.mutateAsync(data)
      toast.success(t("finances.accountsView.toasts.created"))
      setCreateOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleUpdate(data: BankAccountInput) {
    try {
      await updateMutation.mutateAsync(data)
      toast.success(t("finances.accountsView.toasts.updated"))
      setEditTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleTransfer(data: AccountTransferInput) {
    try {
      await transferMutation.mutateAsync(data)
      toast.success(t("finances.transferForm.toasts.created"))
      setTransferOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync(deleteTarget.id)
      toast.success(t("finances.accountsView.toasts.deleted"))
      setDeleteTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleUpdateTransfer(data: AccountTransferInput) {
    try {
      await updateTransferMutation.mutateAsync(data)
      toast.success(t("finances.transferForm.toasts.updated"))
      setEditTransferTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  async function handleDeleteTransfer() {
    if (!deleteTransferTarget) return
    try {
      await deleteTransferMutation.mutateAsync(deleteTransferTarget.id)
      toast.success(t("finances.transferForm.toasts.deleted"))
      setDeleteTransferTarget(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.error"))
    }
  }

  const fmt = (n: string | number) => Number(n).toLocaleString("fr-FR", { style: "currency", currency: "EUR" })

  const columns: Column<Account>[] = [
    {
      key: "account",
      header: t("finances.accountsView.columns.account"),
      cell: (a) => (
        <div>
          <p className="font-medium">{a.accountName}</p>
          <p className="text-xs text-muted-foreground">{a.bankName}{a.ibanLast4 ? ` · ****${a.ibanLast4}` : ""}</p>
        </div>
      ),
    },
    {
      key: "balance",
      header: t("finances.accountsView.columns.balance"),
      className: "w-32 text-right",
      cell: (a) => (
        <span className={`font-semibold tabular-nums ${Number(a.currentBalance) >= 0 ? "text-green-600 dark:text-green-400" : "text-destructive"}`}>
          {fmt(a.currentBalance)}
        </span>
      ),
    },
    {
      key: "status",
      header: t("finances.accountsView.columns.status"),
      className: "w-24",
      cell: (a) => a.isActive
        ? <Badge variant="success">{t("finances.accountsView.status.actif")}</Badge>
        : <Badge variant="secondary">{t("finances.accountsView.status.inactif")}</Badge>,
    },
    ...(canEditComptabilite ? [{
      key: "actions",
      header: "",
      className: "w-10",
      cell: (a: Account) => (
        <RowActions actions={[
          { label: t("finances.accountsView.actions.edit"),  icon: <PencilSimpleIcon className="size-3.5" />, onClick: () => setEditTarget(a) },
          { label: t("finances.accountsView.actions.delete"), icon: <TrashIcon className="size-3.5" />,  destructive: true, separator: true, onClick: () => setDeleteTarget(a) },
        ]} />
      ),
    }] : []),
  ]

  const transferColumns: Column<Transfer>[] = [
    {
      key: "accounts",
      header: t("finances.transfersView.columns.accounts"),
      cell: (tr) => (
        <span className="text-sm">
          {tr.fromAccount.accountName} <ArrowsLeftRightIcon className="mx-1 inline size-3.5 text-muted-foreground" /> {tr.toAccount.accountName}
        </span>
      ),
    },
    {
      key: "amount",
      header: t("finances.transfersView.columns.amount"),
      className: "w-32 text-right",
      cell: (tr) => <span className="font-semibold tabular-nums">{fmt(tr.amount)}</span>,
    },
    {
      key: "date",
      header: t("finances.transfersView.columns.date"),
      className: "w-28",
      cell: (tr) => new Date(tr.date).toLocaleDateString("fr-FR", { timeZone: "UTC" }),
    },
    {
      key: "note",
      header: t("finances.transfersView.columns.note"),
      cell: (tr) => <span className="text-xs text-muted-foreground">{tr.note ?? ""}</span>,
    },
    ...(canEditComptabilite ? [{
      key: "actions",
      header: "",
      className: "w-10",
      cell: (tr: Transfer) => (
        <RowActions actions={[
          { label: t("finances.accountsView.actions.edit"),  icon: <PencilSimpleIcon className="size-3.5" />, onClick: () => setEditTransferTarget(tr) },
          { label: t("finances.accountsView.actions.delete"), icon: <TrashIcon className="size-3.5" />,  destructive: true, separator: true, onClick: () => setDeleteTransferTarget(tr) },
        ]} />
      ),
    }] : []),
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("finances.accountsView.title")}
        description={t("finances.accountsView.description")}
        action={canEditComptabilite && (
          <div className="flex gap-2">
            {activeAccounts.length >= 2 && (
              <Button size="sm" variant="outline" onClick={() => setTransferOpen(true)}>
                <ArrowsLeftRightIcon className="mr-1.5 size-4" />
                {t("finances.transfersView.add")}
              </Button>
            )}
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <PlusIcon className="mr-1.5 size-4" />
              {t("finances.accountsView.add")}
            </Button>
          </div>
        )}
      />

      <DataTable
        columns={columns}
        data={accounts as Account[]}
        loading={isLoading}
        keyExtractor={(a) => a.id}
        empty={t("finances.accountsView.noAccounts")}
      />

      {(accounts.length >= 2 || transfers.length > 0) && (
        <div className="space-y-2 pt-4">
          <h3 className="text-sm font-medium">{t("finances.transfersView.title")}</h3>
          <DataTable
            columns={transferColumns}
            data={transfers as Transfer[]}
            loading={transfersLoading}
            keyExtractor={(tr) => tr.id}
            empty={t("finances.transfersView.noTransfers")}
          />
        </div>
      )}

      <Modal open={createOpen} onOpenChange={setCreateOpen} title={t("finances.accountsView.newAccountTitle")} size="md" dismissable={false}>
        <BankAccountForm onSubmit={handleCreate} onCancel={() => setCreateOpen(false)} loading={createMutation.isPending} />
      </Modal>

      <Modal open={transferOpen} onOpenChange={setTransferOpen} title={t("finances.transfersView.newTransferTitle")} size="md" dismissable={false}>
        <AccountTransferForm accounts={activeAccounts} onSubmit={handleTransfer} onCancel={() => setTransferOpen(false)} loading={transferMutation.isPending} />
      </Modal>

      <Modal open={!!editTransferTarget} onOpenChange={(o) => !o && setEditTransferTarget(null)} title={t("finances.transfersView.editTransferTitle")} size="md" dismissable={false}>
        <AccountTransferForm
          accounts={editTransferAccounts}
          defaultValues={editTransferTarget ? {
            fromAccountId: editTransferTarget.fromAccountId,
            toAccountId:   editTransferTarget.toAccountId,
            amount:        parseFloat(editTransferTarget.amount),
            date:          editTransferTarget.date.split("T")[0],
            note:          editTransferTarget.note ?? "",
          } : undefined}
          onSubmit={handleUpdateTransfer}
          onCancel={() => setEditTransferTarget(null)}
          loading={updateTransferMutation.isPending}
        />
      </Modal>

      <ConfirmDialog
        open={!!deleteTransferTarget}
        onOpenChange={(o) => !o && setDeleteTransferTarget(null)}
        title={t("finances.transfersView.deleteConfirmTitle")}
        description={deleteTransferTarget ? `${deleteTransferTarget.fromAccount.accountName} → ${deleteTransferTarget.toAccount.accountName}` : ""}
        confirmLabel={t("common.delete")}
        loading={deleteTransferMutation.isPending}
        onConfirm={handleDeleteTransfer}
      />

      <Modal open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)} title={t("finances.accountsView.editAccountTitle")} size="md" dismissable={false}>
        <BankAccountForm
          defaultValues={editTarget ? {
            bankName:       editTarget.bankName,
            accountName:    editTarget.accountName,
            ibanLast4:      editTarget.ibanLast4 ?? "",
            currency:       editTarget.currency,
            openingBalance: parseFloat(editTarget.openingBalance),
            isActive:       editTarget.isActive,
          } : undefined}
          onSubmit={handleUpdate}
          onCancel={() => setEditTarget(null)}
          loading={updateMutation.isPending}
        />
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={t("finances.accountsView.deleteConfirmTitle")}
        description={deleteTarget ? `${deleteTarget.accountName} — ${deleteTarget.bankName}` : ""}
        confirmLabel={t("common.delete")}
        loading={deleteMutation.isPending}
        onConfirm={handleDelete}
      />
    </div>
  )
}
